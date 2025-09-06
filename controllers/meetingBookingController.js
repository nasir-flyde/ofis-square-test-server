import mongoose from "mongoose";
import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoomPricing from "../models/meetingRoomPricingModel.js";
import Member from "../models/memberModel.js";
import WalletService from "../services/walletService.js";

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
    bufferMinutes = 15,
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

  // Conflict check with buffer
  const bufferedStart = addMinutes(start, -bufferMinutes);
  const bufferedEnd = addMinutes(end, bufferMinutes);

  const overlap = await MeetingBooking.findOne({
    room: room._id,
    status: "booked",
    start: { $lt: bufferedEnd },
    end: { $gt: bufferedStart },
  }).lean();

  if (overlap) return { ok: false, reason: "Time slot conflicts with an existing booking (consider buffer)" };

  return { ok: true };
}

// Create booking with conflict and availability checks
export const createBooking = async (req, res) => {
  try {
    const { 
      room: roomId, 
      member, 
      clientId, 
      paymentMethod, 
      idempotencyKey, 
      title, 
      description, 
      start, 
      end, 
      attendeesCount, 
      amenitiesRequested, 
      currency, 
      amount, 
      notes 
    } = req.body || {};
    
    if (!roomId) return res.status(400).json({ success: false, message: "room is required" });
    if (!start || !end) return res.status(400).json({ success: false, message: "start and end are required" });

    // Validate member belongs to client if both provided
    if (clientId && member) {
      const memberRecord = await Member.findOne({ _id: member, client: clientId });
      if (!memberRecord) {
        return res.status(400).json({ success: false, message: "Member not found in specified client" });
      }
    }

    const room = await MeetingRoom.findById(roomId);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const avail = await checkAvailability(room, new Date(start), new Date(end));
    if (!avail.ok) return res.status(400).json({ success: false, message: avail.reason });

    // Handle credit payment
    let paymentDetails = {};
    if (paymentMethod === "credits" && clientId) {
      if (!idempotencyKey) {
        return res.status(400).json({ success: false, message: "idempotencyKey is required for credit payments" });
      }

      // Calculate duration in hours
      const durationHours = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
      
      // Get pricing for this room (default to 1 credit per hour if not set)
      const pricing = await MeetingRoomPricing.findOne({ meetingRoom: roomId });
      const creditsPerHour = pricing?.creditsPerHour || 1;
      const requiredCredits = Math.ceil(creditsPerHour * durationHours);

      // Consume credits with overdraft support
      const result = await WalletService.consumeCreditsWithOverdraft({
        clientId,
        memberId: member,
        requiredCredits,
        idempotencyKey,
        refType: "meeting_booking",
        refId: new mongoose.Types.ObjectId(), // Will be updated with booking ID after creation
        meta: { 
          roomId, 
          durationHours, 
          creditsPerHour,
          title: title || "Meeting booking"
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
    } else {
      // Cash/card payment
      paymentDetails = { 
        method: paymentMethod || "cash", 
        amount: amount || 0 
      };
    }

    const booking = await MeetingBooking.create({
      room: roomId,
      member: member || undefined,
      client: clientId || undefined,
      title: title || undefined,
      description: description || undefined,
      start: new Date(start),
      end: new Date(end),
      attendeesCount: attendeesCount || undefined,
      amenitiesRequested: Array.isArray(amenitiesRequested) ? amenitiesRequested : undefined,
      status: "booked",
      payment: paymentDetails,
      currency: currency || undefined,
      notes: notes || undefined,
    });

    return res.status(201).json({ success: true, data: booking });
  } catch (error) {
    console.error("Create booking error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// List bookings with filters
export const listBookings = async (req, res) => {
  try {
    const { room, member, status, from, to } = req.query || {};
    const filter = {};
    if (room) filter.room = room;
    if (member) filter.member = member;
    if (status) filter.status = status;
    if (from || to) {
      filter.start = filter.start || {};
      if (from) filter.start.$gte = new Date(from);
      if (to) filter.start.$lte = new Date(to);
    }

    const bookings = await MeetingBooking.find(filter)
      .populate("room", "name capacity amenities")
      .populate("member", "firstName lastName email phone companyName")
      .sort({ start: 1 });

    return res.json({ success: true, data: bookings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const booking = await MeetingBooking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (booking.status !== "booked") return res.status(400).json({ success: false, message: "Only booked reservations can be cancelled" });

    booking.status = "cancelled";
    await booking.save();
    return res.json({ success: true, data: booking });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
