import mongoose from "mongoose";
import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoomPricing from "../models/meetingRoomPricingModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import WalletService from "../services/walletService.js";
import Visitor from "../models/visitorModel.js";

// Convert date to IST time string (HH:MM)
function toHHMM(date) {
  return new Date(date).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function addMinutes(dt, mins) {
  return new Date(dt.getTime() + mins * 60000);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

async function checkAvailability(room, start, end) {
  if (!room || !start || !end) return { ok: false, reason: "Missing room or times" };
  if (!(start instanceof Date)) start = new Date(start);
  if (!(end instanceof Date)) end = new Date(end);
  if (isNaN(start) || isNaN(end)) return { ok: false, reason: "Invalid dates" };
  if (end <= start) return { ok: false, reason: "End must be after start" };

  if (room.status !== "active") return { ok: false, reason: "Room inactive" };

  const { availability = {}, blackoutDates = [] } = room;
  const {
    daysOfWeek = [1, 2, 3, 4, 5],
    openTime = "09:00",
    closeTime = "19:00",
    minBookingMinutes = 30,
    maxBookingMinutes = 480,
  } = availability;

  // Day of week rule
  const dow = start.getDay();
  if (!daysOfWeek.includes(dow)) return { ok: false, reason: "Room not available on this day" };

  // Must be same-day booking for now (simplifies hours logic)
  if (!sameDay(start, end)) return { ok: false, reason: "Bookings must start and end on the same day" };

  const duration = (end - start) / 60000; // minutes
  if (duration < minBookingMinutes) return { ok: false, reason: `Minimum booking is ${minBookingMinutes} minutes` };
  if (duration > maxBookingMinutes) return { ok: false, reason: `Maximum booking is ${maxBookingMinutes} minutes` };

  // Within operating hours
// Within operating hours (IST)
const startHHMM = toHHMM(start);
const endHHMM = toHHMM(end);
if (startHHMM < openTime || endHHMM > closeTime) {
  return { 
    ok: false, 
    reason: `Booking must be within operating hours ${openTime}-${closeTime} IST` 
  };
}

  // Blackout dates
  const startDayStr = start.toISOString().substring(0, 10);
  const isBlackout = (blackoutDates || []).some((d) => new Date(d).toISOString().substring(0, 10) === startDayStr);
  if (isBlackout) return { ok: false, reason: "Room is blacked out on this date" };

  // Conflict check without buffer
  const overlap = await MeetingBooking.findOne({
    room: room._id,
    status: "booked",
    start: { $lt: end },
    end: { $gt: start },
  }).lean();

  if (overlap) return { ok: false, reason: "Time slot conflicts with an existing booking" };

  return { ok: true };
}

// Create booking with conflict and availability checks
export const createBooking = async (req, res) => {
  try {
    const { 
      room: roomId, 
      member, 
      memberId, 
      client, 
      paymentMethod, 
      idempotencyKey, 
      visitors,
      start, 
      end, 
      amenitiesRequested, 
      currency, 
      amount, 
      notes 
    } = req.body || {};
    
    if (!roomId) return res.status(400).json({ success: false, message: "room is required" });
    if (!start || !end) return res.status(400).json({ success: false, message: "start and end are required" });

    // Determine member/client context (admin flow may not have a member)
    const currentMemberId = req.memberId || memberId || null;
    let clientId = null;
    let memberDoc = null;
    if (currentMemberId) {
      // Validate member and derive client from member
      memberDoc = await Member.findById(currentMemberId).populate('client');
      if (!memberDoc) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }
      clientId = memberDoc.client?._id;
    } else {
      // Admin/community flow: allow booking with a client only
      const clientFromBody = client;
      if (!clientFromBody) {
        return res.status(400).json({ success: false, message: "client or memberId is required" });
      }
      const clientDoc = await Client.findById(clientFromBody).select('_id');
      if (!clientDoc) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
      clientId = clientDoc._id;
    }

    const room = await MeetingRoom.findById(roomId);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const avail = await checkAvailability(room, new Date(start), new Date(end));
    if (!avail.ok) return res.status(400).json({ success: false, message: avail.reason });

    // Calculate duration and pricing
    const durationHours = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
    const pricing = await MeetingRoomPricing.findOne({ meetingRoom: roomId });
    // For cash/card payments we use daily pricing (quantity should be 1)
    const dailyRate = room.pricing?.dailyRate || pricing?.dailyRate || 500; // Default daily rate fallback
    // No GST for meeting room cash invoices per requirement
    const taxAmount = 0;

    // Handle credit payment
    let paymentDetails = {};
    let invoice = null;
    let bookingStatus = "booked";

    if (paymentMethod === "credits") {
      // Credits can only be used with a valid member context
      if (!currentMemberId) {
        return res.status(400).json({ success: false, code: "MEMBER_REQUIRED_FOR_CREDITS", message: "memberId is required when paying with credits" });
      }
      if (!idempotencyKey) {
        return res.status(400).json({ success: false, message: "idempotencyKey is required for credit payments" });
      }

      // Check if current member is allowed to use credits
      if (memberDoc.status !== "active") {
        return res.status(403).json({ success: false, code: "MEMBER_INACTIVE", message: "Member is inactive" });
      }
      if (memberDoc.allowedUsingCredits === false) {
        return res.status(403).json({ success: false, code: "CREDITS_NOT_ALLOWED", message: "This member is not allowed to use credits" });
      }

      // Get pricing for this room (default to 1 credit per hour if not set)
      const creditsPerHour = pricing?.creditsPerHour || 1;
      const requiredCredits = Math.ceil(creditsPerHour * durationHours);

      // Consume credits with overdraft support
      const result = await WalletService.consumeCreditsWithOverdraft({
        clientId,
        memberId: currentMemberId,
        requiredCredits,
        idempotencyKey,
        refType: "meeting_booking",
        refId: new mongoose.Types.ObjectId(), // Will be updated with booking ID after creation
        meta: { 
          roomId, 
          durationHours, 
          creditsPerHour,
          visitorsCount: visitors?.length || 0
        }
      });

      paymentDetails = {
        method: "credits",
        coveredCredits: result.coveredCredits,
        extraCredits: result.extraCredits,
        overageAmount: result.overageAmount,
        valuePerCredit: result.valuePerCredit,
        idempotencyKey
      };
    } else if (paymentMethod === "cash") {
      // Cash payment - create invoice and set payment_pending status
      bookingStatus = "payment_pending";
      
      if (clientId) {
        invoice = new Invoice({
          client: clientId,
          type: "regular",
          category: "meeting_room",
          invoice_number: `MR-${Date.now()}`,
          line_items: [{
            description: `Meeting Room - ${room.name} (Daily)`,
            quantity: 1,
            unitPrice: dailyRate,
            amount: dailyRate,
            rate: dailyRate
          }],
          sub_total: dailyRate,
          tax_total: 0,
          total: dailyRate,
          status: "draft",
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        await invoice.save();
      }

      paymentDetails = { 
        method: "cash", 
        amount: dailyRate 
      };
    } else {
      // Other payment methods
      paymentDetails = { 
        method: paymentMethod || "cash", 
        amount: amount || undefined 
      };
    }

    const booking = await MeetingBooking.create({
      room: roomId,
      member: currentMemberId || undefined,
      client: clientId || undefined,
      visitors: Array.isArray(visitors) ? visitors : undefined,
      start: new Date(start),
      end: new Date(end),
      amenitiesRequested: Array.isArray(amenitiesRequested) ? amenitiesRequested : undefined,
      status: bookingStatus,
      payment: paymentDetails,
      currency: currency || undefined,
      notes: notes || undefined,
      invoice: invoice?._id || undefined,
    });

    // Add reserved slot to meeting room
    const bookingStart = new Date(start);
    const bookingEnd = new Date(end);
    
    // Convert booking times to 12-hour format with AM/PM
    const startTimeStr = bookingStart.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });
    const endTimeStr = bookingEnd.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    // Add to reserved slots
    const reservedSlot = {
      date: new Date(bookingStart.setHours(0, 0, 0, 0)),
      startTime: startTimeStr,
      endTime: endTimeStr,
      bookingId: booking._id
    };

    room.reservedSlots.push(reservedSlot);
    await room.save();

    const responseData = {
      booking,
    };
    if (invoice) {
      responseData.invoice = invoice;
    }
    if (paymentMethod === 'cash') {
      responseData.razorpayConfig = {
        key: process.env.RAZORPAY_KEY_ID || "rzp_test_02U4mUmreLeYrU",
        amount: dailyRate * 100, // Convert to paise (no GST)
        currency: "INR",
        name: "Ofis Square",
        description: `Meeting Room - ${room.name}`,
        meetingBookingId: booking._id
      };
    }

    return res.status(201).json({ success: true, data: responseData });
  } catch (error) {
    console.error("Create booking error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// List bookings with filters
export const listBookings = async (req, res) => {
  try {
    const { room, member, status, from, to, buildingId, building } = req.query || {};
    const filter = {};
    if (room) filter.room = room;
    if (member) filter.member = member;
    if (status) filter.status = status;
    if (from || to) {
      filter.start = filter.start || {};
      if (from) filter.start.$gte = new Date(from);
      if (to) filter.start.$lte = new Date(to);
    }

    // If buildingId/building is provided (from community admin), scope bookings to rooms in that building
    const bId = buildingId || building;
    if (bId && !room) {
      try {
        const roomsInBuilding = await MeetingRoom.find({ building: bId }).select('_id').lean();
        const roomIds = roomsInBuilding.map(r => r._id);
        filter.room = { $in: roomIds };
      } catch (err) {
        return res.json({ success: true, data: [] });
      }
    }

    const bookings = await MeetingBooking.find(filter)
      .populate("room", "name capacity amenities building")
      .populate("member", "firstName lastName email phone companyName")
      .populate("visitors", "name email phone company")
      .sort({ start: 1 });

    return res.json({ success: true, data: bookings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const booking = await MeetingBooking.findById(req.params.id).populate('room');
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.status !== "booked" && booking.status !== "payment_pending") {
      return res.status(400).json({ success: false, message: "Only booked or payment pending reservations can be cancelled" });
    }

    booking.status = "cancelled";
    await booking.save();

    // Remove reserved slot from meeting room
    if (booking.room) {
      const room = await MeetingRoom.findById(booking.room._id);
      if (room) {
        const bookingDate = new Date(booking.start);
        bookingDate.setHours(0, 0, 0, 0);

        // Filter out the reserved slot for this booking
        room.reservedSlots = room.reservedSlots.filter(slot => {
          return String(slot.bookingId) !== String(booking._id);
        });

        await room.save();
      }
    }

    return res.json({ success: true, data: booking });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get single booking by ID
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "id is required" });

    const booking = await MeetingBooking.findById(id)
      .populate("room", "name capacity amenities")
      .populate("member", "firstName lastName email phone companyName user")
      .populate("client", "companyName name email phone")
      .populate("visitors", "name email phone company")
      .populate({ path: "invoice", select: "invoiceNumber status total" });

    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    return res.json({ success: true, data: booking });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Add a visitor (existing or new) to a meeting booking
export const addVisitorToBooking = async (req, res) => {
  try {
    const { id } = req.params; // booking id
    const { visitorId, visitor } = req.body || {};

    if (!id) return res.status(400).json({ success: false, message: "booking id is required" });

    // Find booking with minimal required data
    const booking = await MeetingBooking.findById(id).populate({ path: "room", select: "building name" });
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    if (["cancelled", "completed"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot add visitors to a ${booking.status} booking` });
    }

    let newVisitorId = null;

    if (visitorId) {
      // Attach existing visitor
      const existingVisitor = await Visitor.findById(visitorId);
      if (!existingVisitor) {
        return res.status(404).json({ success: false, message: "Visitor not found" });
      }
      newVisitorId = existingVisitor._id;
    } else if (visitor && typeof visitor === "object") {
      // Create a new visitor and attach
      const { name, email, phone, companyName, notes, purpose } = visitor;
      if (!name?.trim()) {
        return res.status(400).json({ success: false, message: "visitor.name is required" });
      }

      const created = await Visitor.create({
        name: name.trim(),
        email: email?.trim(),
        phone: phone?.trim(),
        companyName: companyName?.trim(),
        hostMember: booking.member || undefined,
        purpose: purpose?.trim(),
        expectedVisitDate: booking.start,
        expectedArrivalTime: booking.start,
        expectedDepartureTime: booking.end,
        building: booking.room?.building || undefined,
        notes: notes?.trim(),
        status: "invited",
        createdBy: req.user?.id || undefined,
      });

      newVisitorId = created._id;
    } else {
      return res.status(400).json({ success: false, message: "Provide visitorId or visitor object" });
    }

    // Prevent duplicates
    const alreadyAdded = (booking.visitors || []).some((v) => String(v) === String(newVisitorId));
    if (!alreadyAdded) {
      booking.visitors = [...(booking.visitors || []), newVisitorId];
      await booking.save();
    }

    const updated = await MeetingBooking.findById(id)
      .populate("room", "name capacity amenities")
      .populate("member", "firstName lastName email phone companyName")
      .populate("visitors", "name email phone company status expectedVisitDate")
      .populate({ path: "invoice", select: "invoice_number status total" });

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Add visitor to booking error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get bookings by member ID with detailed information
export const getBookingsByMember = async (req, res) => {
  try {
    // Get memberId from middleware or params
    const memberId = req.memberId || req.member?._id || req.params.memberId;

    if (!memberId) {
      return res.status(400).json({ 
        success: false, 
        message: "Member ID is required" 
      });
    }

    const { status, from, to, limit = 50, page = 1 } = req.query || {};
    
    // Build filter
    const filter = { member: memberId };
    if (status) filter.status = status;
    if (from || to) {
      filter.start = filter.start || {};
      if (from) filter.start.$gte = new Date(from);
      if (to) filter.start.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;

    // Get bookings with full details
    const bookings = await MeetingBooking.find(filter)
      .populate({
        path: 'room',
        select: 'name capacity amenities images pricing building',
        populate: {
          path: 'building',
          select: 'name address'
        }
      })
      .populate({
        path: 'member',
        select: 'firstName lastName email phone companyName',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'visitors',
        select: 'name email phone company'
      })
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone'
      })
      .populate({
        path: 'invoice',
        select: 'invoice_number status total due_date'
      })
      .sort({ start: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const totalCount = await MeetingBooking.countDocuments(filter);

    // Format response with detailed booking information
    const formattedBookings = bookings.map(booking => ({
      id: booking._id,
      room: {
        id: booking.room?._id,
        name: booking.room?.name,
        capacity: booking.room?.capacity,
        amenities: booking.room?.amenities || [],
        photos: booking.room?.images || [],
        pricing: booking.room?.pricing,
        building: booking.room?.building ? {
          name: booking.room.building.name,
          address: booking.room.building.address
        } : null
      },
      bookedBy: {
        id: booking.member?._id,
        firstName: booking.member?.firstName,
        lastName: booking.member?.lastName,
        name: `${booking.member?.firstName || ''} ${booking.member?.lastName || ''}`.trim(),
        email: booking.member?.email,
        phone: booking.member?.phone,
        companyName: booking.member?.companyName
      },
      visitors: (booking.visitors || []).map(visitor => ({
        id: visitor._id,
        name: visitor.name,
        email: visitor.email,
        phone: visitor.phone,
        company: visitor.company
      })),
      timing: {
        start: booking.start,
        end: booking.end,
        duration: booking.end && booking.start 
          ? Math.round((new Date(booking.end) - new Date(booking.start)) / (1000 * 60)) 
          : null,
        durationUnit: 'minutes'
      },
      status: booking.status,
      payment: booking.payment,
      amenitiesRequested: booking.amenitiesRequested || [],
      notes: booking.notes,
      invoice: booking.invoice ? {
        id: booking.invoice._id,
        invoiceNumber: booking.invoice.invoice_number,
        status: booking.invoice.status,
        total: booking.invoice.total,
        dueDate: booking.invoice.due_date
      } : null,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    return res.json({ 
      success: true, 
      data: {
        bookings: formattedBookings,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get bookings by member error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Reports: utilization per day (bookings/day) and peak usage hours
export const utilizationReport = async (req, res) => {
  try {
    const { room, from, to } = req.query || {};
    const match = { status: "booked" };
    if (room) match.room = new mongoose.Types.ObjectId(room);
    if (from) match.start = { ...(match.start || {}), $gte: new Date(from) };
    if (to) match.start = { ...(match.start || {}), $lte: new Date(to) };

    // Group by day
    const pipeline = [
      { $match: match },
      {
        $project: {
          room: 1,
          start: 1,
          end: 1,
          day: { $dateToString: { format: "%Y-%m-%d", date: "$start" } },
          hour: { $hour: "$start" },
        },
      },
      {
        $facet: {
          byDay: [
            { $group: { _id: "$day", bookings: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          peakHour: [
            { $group: { _id: "$hour", bookings: { $sum: 1 } } },
            { $sort: { bookings: -1 } },
            { $limit: 1 },
          ],
        },
      },
    ];

    const result = await MeetingBooking.aggregate(pipeline);
    const data = result?.[0] || { byDay: [], peakHour: [] };
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
