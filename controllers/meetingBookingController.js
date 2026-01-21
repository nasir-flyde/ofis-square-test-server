import mongoose from "mongoose";
import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoomPricing from "../models/meetingRoomPricingModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import WalletService from "../services/walletService.js";
import Visitor from "../models/visitorModel.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { provisionAccessForMeetingBooking, revokeAccessForMeetingBooking } from "../services/meetingAccessService.js";
import Payment from "../models/paymentModel.js";
import loggedRazorpay from "../utils/loggedRazorpay.js";
import { recordCancellation } from "./cancelledBookingController.js";
import { getValidAccessToken } from "../utils/zohoTokenManager.js";

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

// Helper: convert any date-like to IST Date object
function toIST(date) {
  try {
    return new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  } catch (e) {
    return new Date(date);
  }
}

// Helper: get IST day in YYYY-MM-DD string
function formatYMDIST(dateLike) {
  const d = toIST(dateLike);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Compute discounted totals with 18% GST
function computeInvoiceTotals(baseAmount, percent) {
  const pct = Math.max(0, Math.min(100, Number(percent || 0)));
  const discountAmount = Math.max(0, Math.round((Number(baseAmount || 0) * pct) / 100));
  const sub_total = Math.max(0, Number(baseAmount || 0) - discountAmount);
  const gstRate = 18; // 18% GST
  const tax_total = Math.round((sub_total * gstRate) / 100);
  const total = Math.max(0, sub_total + tax_total);
  return {
    discountAmount,
    sub_total,
    tax_total,
    total,
  };
}

// Resolve discount cap based on flag and available configs
async function resolveDiscountCap({ room, pricing, usingDefaultBuildingDiscount }) {
  const defaultCap = Number(process.env.MEETING_DISCOUNT_DEFAULT_CAP_PERCENT || 10);
  let buildingCap;
  try {
    if (room?.building) {
      const b = await Building.findById(room.building).select('communityDiscountMaxPercent').lean();
      buildingCap = b?.communityDiscountMaxPercent;
    }
  } catch (e) {
    buildingCap = undefined;
  }

  if (usingDefaultBuildingDiscount === true) {
    return typeof buildingCap === 'number' ? buildingCap : defaultCap;
  }

  const roomCap = room?.communityMaxDiscountPercent;
  if (typeof roomCap === 'number') return roomCap;
  if (typeof buildingCap === 'number') return buildingCap;
  return defaultCap;
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
    openTime: roomOpen = "09:00",
    closeTime: roomClose = "19:00",
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

  // Within operating hours (IST)
  // Prefer building-level opening/closing times if present
  let openTime = roomOpen;
  let closeTime = roomClose;
  try {
    if (room.building) {
      const b = await Building.findById(room.building).select('openingTime closingTime').lean();
      if (b?.openingTime) openTime = b.openingTime;
      if (b?.closingTime) closeTime = b.closingTime;
    }
  } catch (e) {}

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
    status: { $in: ["booked", "payment_pending"] },
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
      notes,
      discount, // { percent, reason }
      usingDefaultBuildingDiscount, // boolean
      // External partner payload (optional)
      externalSource,
      referenceNumber,
      name,
      email,
      phone,
      guests, // array of { name, email, phone }
      guest: bodyGuest,
      guestId: bodyGuestId
    } = req.body || {};
    
    if (!roomId) return res.status(400).json({ success: false, message: "room is required" });
    if (!start || !end) return res.status(400).json({ success: false, message: "start and end are required" });

    // Determine member/client/guest context (admin flow may not have a member)
    const currentMemberId = req.memberId || memberId || null;
    let clientId = null;
    let guestId = req.guestId || bodyGuestId || null;
    let memberDoc = null;
    if (currentMemberId) {
      // Validate member and derive client from member
      memberDoc = await Member.findById(currentMemberId).populate('client');
      if (!memberDoc) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }
      clientId = memberDoc.client?._id;
    } else {
      // Admin/community or external partner/guest flow
      const clientFromBody = client;
      // If no member/client context, allow guest context (on-demand)
      if (!clientFromBody && !externalSource && !guestId && !bodyGuest) {
        return res.status(400).json({ success: false, message: "client, memberId or guest context is required" });
      }
      if (clientFromBody) {
        const clientDoc = await Client.findById(clientFromBody).select('_id');
        if (!clientDoc) {
          return res.status(404).json({ success: false, message: "Client not found" });
        }
        clientId = clientDoc._id;
      }
      // If on-demand body.guest is provided, create/ensure a Guest record and use its _id
      if (!guestId && bodyGuest && typeof bodyGuest === 'object') {
        const gName = (bodyGuest.name || 'Guest').toString().trim();
        const gEmail = (bodyGuest.email || '').toString().trim() || undefined;
        const gPhone = (bodyGuest.phone || '').toString().trim() || undefined;
        const createdGuest = await Guest.create({ name: gName, email: gEmail, phone: gPhone });
        guestId = createdGuest._id;
      }
    }

    const room = await MeetingRoom.findById(roomId).populate('building');
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const avail = await checkAvailability(room, new Date(start), new Date(end));
    if (!avail.ok) return res.status(400).json({ success: false, message: avail.reason });

    // If external partner provides a primary booker and guests, create Visitor records
    const visitorIds = [];
    if (externalSource && (name || email || phone)) {
      try {
        const expectedVisitDate = new Date(start);
        const primaryVisitor = await Visitor.create({
          name: (name || 'Guest').trim(),
          email: email?.trim(),
          phone: phone?.trim(),
          companyName: undefined,
          hostMember: currentMemberId || undefined,
          hostClient: clientId || undefined,
          purpose: 'Meeting Room Booking',
          expectedVisitDate,
          expectedArrivalTime: new Date(start),
          expectedDepartureTime: new Date(end),
          building: room.building?._id || room.building,
          status: 'invited',
          externalSource,
          externalReferenceNumber: referenceNumber,
          bookingRole: 'primary'
        });
        visitorIds.push(primaryVisitor._id);
        if (Array.isArray(guests)) {
          for (const g of guests) {
            if (!g || (!g.name && !g.email && !g.phone)) continue;
            const gv = await Visitor.create({
              name: (g.name || 'Guest').trim(),
              email: g.email?.trim(),
              phone: g.phone?.trim(),
              hostMember: currentMemberId || undefined,
              hostClient: clientId || undefined,
              purpose: 'Meeting Room Booking',
              expectedVisitDate,
              expectedArrivalTime: new Date(start),
              expectedDepartureTime: new Date(end),
              building: room.building?._id || room.building,
              status: 'invited',
              externalSource,
              externalReferenceNumber: referenceNumber,
              bookingRole: 'guest'
            });
            visitorIds.push(gv._id);
          }
        }
      } catch (e) {
        // Do not fail booking if visitor creation fails; log and continue
        console.error('External visitor creation failed:', e?.message);
      }
    }

    // Calculate duration and pricing
    const durationHours = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
    const pricing = await MeetingRoomPricing.findOne({ meetingRoom: roomId });
    // For cash/card payments we use daily pricing (quantity should be 1)
    const dailyRate = room.pricing?.dailyRate || pricing?.dailyRate || 500; // Default daily rate fallback
    // Apply 18% GST on taxable base (after discount)

    // Handle credit payment
    let paymentDetails = {};
    let invoice = null;
    let bookingStatus = "booked";
    // Discount state
    let discountStatus = "none";
    let appliedDiscountPercent = 0;
    let discountAmount = 0;
    let requestedDiscountPercent;
    let requestedReason;
    let requestedBy = req.user?.id || undefined;
    const hasDiscountRequest = discount && typeof discount === 'object' && discount.percent != null;

    // Resolve discount cap early if a discount is requested and not paying with credits
    let discountCap;
    if (hasDiscountRequest) {
      // Reject discount with credits
      if (paymentMethod === "credits") {
        return res.status(400).json({ success: false, code: "DISCOUNT_NOT_ALLOWED_WITH_CREDITS", message: "Discounts are not applicable when paying with credits" });
      }
      try {
        discountCap = await resolveDiscountCap({ room, pricing, usingDefaultBuildingDiscount });
      } catch (e) {
        discountCap = Number(process.env.MEETING_DISCOUNT_DEFAULT_CAP_PERCENT || 10);
      }
      requestedDiscountPercent = Number(discount.percent);
      requestedReason = discount.reason;
      if (requestedDiscountPercent <= discountCap) {
        // immediate apply
        const totals = computeInvoiceTotals(dailyRate, requestedDiscountPercent);
        appliedDiscountPercent = requestedDiscountPercent;
        discountAmount = totals.discountAmount;
        discountStatus = "approved";
      } else {
        discountStatus = "pending";
      }
    }

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
    } else if (paymentMethod === "cash" || paymentMethod === "card" || paymentMethod === "razorpay") {
      // Cash/Card payment - create invoice and set payment_pending status for Razorpay create-order flow
      bookingStatus = "payment_pending";

      if (discountStatus === "pending") {
        // Skip invoice creation; wait for approval
        paymentDetails = { method: paymentMethod || "cash" };
      } else {
        // Apply approved or no discount
        const totals = computeInvoiceTotals(dailyRate, appliedDiscountPercent || 0);
        if (clientId || guestId) {
          invoice = new Invoice({
            ...(clientId ? { client: clientId } : {}),
            ...(guestId ? { guest: guestId } : {}),
            type: "regular",
            category: "meeting_room",
            invoice_number: `MR-${Date.now()}`,
            line_items: [{
              description: `Meeting Room - ${room.name} (Daily)`,
              quantity: 1,
              unitPrice: dailyRate,
              amount: dailyRate, // show gross amount in line item
              rate: dailyRate
            }],
            sub_total: totals.sub_total,
            discount: totals.discountAmount || 0,
            tax_total: totals.tax_total,
            total: totals.total,
            status: "draft",
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
          });

          await invoice.save();
        }

        paymentDetails = { 
          method: paymentMethod || "cash", 
          amount: (invoice?.total ?? totals.total) // GST-inclusive total
        };
      }
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
      guest: guestId || undefined,
      visitors: visitorIds.length ? visitorIds : (Array.isArray(visitors) ? visitors : undefined),
      start: new Date(start),
      end: new Date(end),
      amenitiesRequested: Array.isArray(amenitiesRequested) ? amenitiesRequested : undefined,
      status: bookingStatus,
      payment: paymentDetails,
      currency: currency || undefined,
      notes: notes || undefined,
      invoice: invoice?._id || undefined,
      // discount fields
      usingDefaultBuildingDiscount: !!usingDefaultBuildingDiscount,
      discountStatus,
      requestedDiscountPercent: requestedDiscountPercent,
      requestedBy: discountStatus === 'pending' ? requestedBy : undefined,
      requestedReason: discountStatus === 'pending' ? requestedReason : undefined,
      appliedDiscountPercent: appliedDiscountPercent || 0,
      discountAmount: discountAmount || 0,
      // external idempotency
      externalSource: externalSource || undefined,
      referenceNumber: referenceNumber || undefined,
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

    // Compute IST day string and UTC midnight for that day (visual consistency in DB tools)
    const istYmd = formatYMDIST(bookingStart);
    const utcMidnightOfIstDay = new Date(`${istYmd}T00:00:00.000Z`);

    // Add to reserved slots
    const reservedSlot = {
      // Store UTC midnight of the IST day + denormalized IST day string
      date: utcMidnightOfIstDay,
      dateISTYMD: istYmd,
      startTime: startTimeStr,
      endTime: endTimeStr,
      bookingId: booking._id
    };

    room.reservedSlots.push(reservedSlot);
    await room.save();

    // Notify on confirmed booking (status 'booked') using template 'meeting_booking_confirmed'
    try {
      if (bookingStatus === 'booked') {
        const to = {};
        let emailTo = null;
        if (currentMemberId) {
          to.memberId = currentMemberId;
          if (memberDoc?.client?._id) to.clientId = memberDoc.client._id;
          if (memberDoc?.email) emailTo = memberDoc.email;
        } else if (clientId) {
          to.clientId = clientId;
          try {
            const clientDoc = await Client.findById(clientId).select('email').lean();
            if (clientDoc?.email) emailTo = clientDoc.email;
          } catch {}
        }
        if (emailTo) to.email = emailTo;

        await sendNotification({
          to,
          channels: { email: Boolean(emailTo), sms: false },
          templateKey: 'meeting_booking_confirmed',
          templateVariables: {
            roomName: room?.name,
            date: istYmd,
            startTime: startTimeStr,
            endTime: endTimeStr,
            bookingId: String(booking._id)
          },
          title: 'Meeting Booking Confirmed',
          metadata: {
            category: 'meeting_booking',
            tags: ['meeting_booking_confirmed'],
            route: `/meeting-bookings/${booking._id}`,
            deepLink: `ofis://meeting-bookings/${booking._id}`,
            routeParams: { id: String(booking._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('createBooking: failed to send meeting_booking_confirmed notification:', notifyErr?.message || notifyErr);
    }

    // Schedule reminders for member and visitors before the meeting start
    try {
      const reminderMinutes = Number(process.env.MEETING_BOOKING_REMINDER_MINUTES_BEFORE || 30);
      const startDt = new Date(start);
      const scheduledAt = new Date(startDt.getTime() - reminderMinutes * 60000);
      const now = new Date();
      if (bookingStatus === 'booked' && scheduledAt > now) {
        // Member reminder
        if (currentMemberId && (memberDoc?.email || memberDoc?.phone)) {
          const to = {
            memberId: currentMemberId,
            ...(memberDoc?.client?._id ? { clientId: memberDoc.client._id } : {}),
            ...(memberDoc?.email ? { email: memberDoc.email } : {})
          };
          await sendNotification({
            to,
            channels: { email: Boolean(to.email), sms: false },
            templateKey: 'meeting_booking_reminder',
            templateVariables: {
              roomName: room?.name,
              date: istYmd,
              startTime: startTimeStr,
              endTime: endTimeStr,
              bookingId: String(booking._id)
            },
            title: 'Meeting Reminder',
            metadata: {
              category: 'meeting_booking',
              tags: ['meeting_booking_reminder'],
              route: `/meeting-bookings/${booking._id}`,
              deepLink: `ofis://meeting-bookings/${booking._id}`,
              routeParams: { id: String(booking._id) }
            },
            source: 'system',
            type: 'reminder',
            scheduledAt
          });
        }

        // Visitor reminders (email only if available)
        try {
          const visitorIds = Array.isArray(booking.visitors) ? booking.visitors : [];
          if (visitorIds.length) {
            const visitorDocs = await Visitor.find({ _id: { $in: visitorIds } }).select('email name').lean();
            for (const v of visitorDocs) {
              if (!v?.email) continue;
              const to = { email: v.email, ...(memberDoc?.client?._id ? { clientId: memberDoc.client._id } : {}) };
              await sendNotification({
                to,
                channels: { email: true, sms: false },
                templateKey: 'meeting_booking_reminder',
                templateVariables: {
                  roomName: room?.name,
                  date: istYmd,
                  startTime: startTimeStr,
                  endTime: endTimeStr,
                  bookingId: String(booking._id)
                },
                title: 'Meeting Reminder',
                metadata: {
                  category: 'meeting_booking',
                  tags: ['meeting_booking_reminder'],
                  route: `/visitor-bookings/${booking._id}`,
                  deepLink: `ofis://visitor-bookings/${booking._id}`,
                  routeParams: { id: String(booking._id) }
                },
                source: 'system',
                type: 'reminder',
                scheduledAt
              });
            }
          }
        } catch (e) {
          console.warn('createBooking: failed to schedule visitor reminders:', e?.message || e);
        }
      }
    } catch (remErr) {
      console.warn('createBooking: failed to schedule meeting reminders:', remErr?.message || remErr);
    }

    // If booking is finalized immediately (credits or free) AND visitors exist, provision access for visitors
    if (booking?.status === 'booked' && Array.isArray(booking.visitors) && booking.visitors.length) {
      try { await provisionAccessForMeetingBooking({ bookingId: booking._id }); } catch (e) { console.warn('[MeetingAccess] Provision failed on create', e?.message); }
    }

    const responseData = {
      booking,
    };
    if (invoice) {
      responseData.invoice = invoice;
    }
    if ((paymentMethod === 'cash' || paymentMethod === 'card' || paymentMethod === 'razorpay') && discountStatus !== 'pending') {
      responseData.razorpayConfig = {
        key: process.env.RAZORPAY_KEY_ID || "rzp_test_02U4mUmreLeYrU",
        amount: Math.round((paymentDetails.amount || dailyRate) * 100), // Convert to paise (GST-inclusive)
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
    const { room, member, status, from, to, buildingId, building, guest, guestId } = req.query || {};
    const filter = {};
    if (room) filter.room = room;
    if (member) filter.member = member;
    const gId = guest || guestId;
    if (gId) filter.guest = gId;
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
      .populate("guest", "name email phone")
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
    console.log('[CancelFlow] Begin cancellation', { bookingId: String(req.params.id) });
    // Load booking with room->building to access per-building cancellation settings
    const booking = await MeetingBooking.findById(req.params.id)
      .populate({
        path: 'room',
        select: 'building',
        populate: { path: 'building', select: 'openingTime closingTime meetingCancellationGraceMinutes meetingCancellationCutoffMinutes' }
      });
    if (!booking) {
      console.warn('[CancelFlow] Booking not found', { bookingId: String(req.params.id) });
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    console.log('[CancelFlow] Loaded booking', { bookingId: String(booking._id), status: booking.status, room: String(booking?.room?._id || booking?.room), building: String(booking?.room?.building?._id || booking?.room?.building) });
    if (booking.status !== "booked" && booking.status !== "payment_pending") {
      console.warn('[CancelFlow] Invalid status for cancellation', { bookingId: String(booking._id), status: booking.status });
      return res.status(400).json({ success: false, message: "Only booked or payment pending reservations can be cancelled" });
    }

    // Compute cancellation window (myHQ-style):
    // - within grace minutes from creation
    // - OR before cutoff minutes prior to start (IST-safe)
    const now = new Date();
    const createdAt = new Date(booking.createdAt || booking.start);

    // Building-level grace period (minutes). Fallback to env or default (5) if missing.
    let graceMinutes = 5;
    try {
      const v = booking?.room?.building?.meetingCancellationGraceMinutes;
      graceMinutes = (typeof v === 'number' && !Number.isNaN(v)) ? v : parseInt(process.env.BOOKING_CANCELLATION_GRACE_MINUTES || '5', 10);
      if (!Number.isFinite(graceMinutes) || graceMinutes < 0) graceMinutes = 5;
    } catch (_) {}

    // Cutoff minutes (before start) sourced from building with env/default fallback
    let cutoffMinutes = 60;
    try {
      const cv = booking?.room?.building?.meetingCancellationCutoffMinutes;
      cutoffMinutes = (typeof cv === 'number' && !Number.isNaN(cv)) ? cv : parseInt(process.env.BOOKING_CANCELLATION_CUTOFF_MINUTES || '60', 10);
      if (!Number.isFinite(cutoffMinutes) || cutoffMinutes < 0) cutoffMinutes = 60;
    } catch (_) {}

    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;
    const startIST = toIST(booking.start);
    const cutoffTime = new Date(startIST.getTime() - cutoffMinutes * 60 * 1000);
    const beforeCutoff = now.getTime() < cutoffTime.getTime();

    console.log('[CancelFlow] Window check', {
      bookingId: String(booking._id),
      graceMinutes,
      cutoffMinutes,
      createdAtISO: createdAt.toISOString(),
      startIST: startIST.toISOString(),
      cutoffTimeISO: cutoffTime.toISOString(),
      withinGrace,
      beforeCutoff
    });
    if (!(withinGrace || beforeCutoff)) {
      console.warn('[CancelFlow] Outside window, denying cancellation', { bookingId: String(booking._id) });
      return res.status(403).json({ success: false, message: "Outside Booking Cancellation Window" });
    }

    // Proceed with cancellation
    console.log('[CancelFlow] Proceeding to cancel booking', { bookingId: String(booking._id) });
    booking.status = "cancelled";
    await booking.save();
    console.log('[CancelFlow] Booking status saved as cancelled', { bookingId: String(booking._id) });

    // Record cancellation snapshot (idempotent)
    try {
      const reason = req.body?.reason || req.query?.reason;
      const cancelledBy = req.user ? `user:${req.user._id}` : 'system';
      await recordCancellation(booking, { cancelledBy, cancellationReason: reason });
      console.log('[CancelFlow] Cancellation snapshot recorded', { bookingId: String(booking._id) });
    } catch (e) {
      console.error('Failed to record cancelled booking snapshot:', e?.message);
    }

    // Revoke building access (Matrix/WiFi) - non-blocking
    try {
      await revokeAccessForMeetingBooking({ bookingId: booking._id });
      console.log('[CancelFlow] Access revoked (Matrix/WiFi)', { bookingId: String(booking._id) });
    } catch (revErr) {
      console.warn('[MeetingAccess] Revoke failed on cancel', revErr?.message || revErr);
    }

    // If paid with credits, reverse covered credits back to client wallet (idempotent)
    try {
      if (booking?.payment?.method === 'credits') {
        // Determine clientId
        let clientId = booking.client || null;
        if (!clientId && booking.member) {
          try {
            const mem = await Member.findById(booking.member).select('client').lean();
            clientId = mem?.client || null;
          } catch (_) {}
        }
        const creditsToRefund = Number(booking?.payment?.coveredCredits || 0);
        if (clientId && creditsToRefund > 0) {
          const idKey = booking?.payment?.idempotencyKey
            ? `${booking.payment.idempotencyKey}_refund`
            : `meeting_${String(booking._id)}_credits_refund`;
          const reason = (req.body?.reason || req.query?.reason || 'Meeting booking cancelled');
          await WalletService.reverseCredits({
            clientId,
            memberId: booking.member || undefined,
            credits: creditsToRefund,
            idempotencyKey: idKey,
            refType: 'meeting_booking',
            refId: booking._id,
            meta: { reason, relatedInvoiceId: booking.invoice || null, title: 'Meeting booking cancellation' },
          });
          console.log('[CancelFlow] Credits reversed', { bookingId: String(booking._id), creditsToRefund });
        }
      }
    } catch (credErr) {
      console.warn('[Credits] Reverse credits on cancellation failed:', credErr?.message || credErr);
    }

    // Minimal invoice handling: if invoice is still draft, mark as void
    try {
      const invId = booking.invoice?._id || booking.invoice;
      if (invId) {
        const inv = await Invoice.findById(invId);
        if (inv && inv.status === 'draft') {
          inv.status = 'void';
          await inv.save();
          console.log('[CancelFlow] Invoice voided (was draft)', { bookingId: String(booking._id), invoiceId: String(inv._id) });
          // If invoice is linked to Zoho, attempt to void it there as well
          if (inv.zoho_invoice_id) {
            try {
              const accessToken = await getValidAccessToken();
              const orgId = process.env.ZOHO_BOOKS_ORG_ID || process.env.ZOHO_ORG_ID;
              const booksBase = 'https://www.zohoapis.in/books/v3';
              if (accessToken && orgId) {
                const url = `${booksBase}/invoices/${inv.zoho_invoice_id}/status/void?organization_id=${orgId}`;
                const resp = await fetch(url, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json',
                  },
                });
                const data = await resp.json().catch(() => ({}));
                if (resp.ok) {
                  console.log('[CancelFlow] Zoho invoice voided successfully', { zoho_invoice_id: inv.zoho_invoice_id, invoiceId: String(inv._id) });
                } else {
                  console.warn('[CancelFlow] Zoho invoice void failed', { zoho_invoice_id: inv.zoho_invoice_id, message: data?.message || 'Unknown error' });
                }
              } else {
                console.warn('[CancelFlow] Zoho void skipped: missing access token or org id');
              }
            } catch (zErr) {
              console.warn('[CancelFlow] Zoho invoice void error', zErr?.message || zErr);
            }
          }
        }
      }
    } catch (invErr) {
      console.warn('[Invoice] Void draft on cancellation failed:', invErr?.message || invErr);
    }

    // If paid via Razorpay, attempt full refund via Razorpay API (best-effort, with capture-if-needed)
    try {
      const invId = booking.invoice?._id || booking.invoice;
      if (invId) {
        // Do not rely on type; use presence of paymentGatewayRef to infer Razorpay
        const rzPay = await Payment.findOne({ invoice: invId, paymentGatewayRef: { $exists: true, $ne: null } }).sort({ createdAt: -1 }).lean();
        if (rzPay && rzPay.paymentGatewayRef) {
          // Basic idempotency: if there is already a refund recorded, skip
          const alreadyRefunded = Array.isArray(rzPay.refunds) && rzPay.refunds.length > 0;
          if (alreadyRefunded) {
            console.log('[CancelFlow] Razorpay refund skipped (already refunded)', { paymentDocId: String(rzPay._id) });
          } else {
            const amountPaise = Math.max(0, Math.round(Number(rzPay.amount || 0) * 100));
            if (amountPaise > 0) {
              const reason = (req.body?.reason || req.query?.reason || 'meeting_booking_cancelled');
              // Fetch payment to inspect current status
              let paymentStatus = null;
              try {
                const fetched = await loggedRazorpay.fetchPayment(rzPay.paymentGatewayRef, {
                  userId: req.user?.id || null,
                  relatedEntity: 'payment',
                  relatedEntityId: rzPay._id
                });
                paymentStatus = fetched?.status || null;
                console.log('[CancelFlow] Razorpay payment status', { paymentId: rzPay.paymentGatewayRef, status: paymentStatus });
              } catch (fetchErr) {
                console.warn('[Razorpay] fetchPayment failed before refund', fetchErr?.message || fetchErr);
              }

              // If authorized, attempt to capture first
              if (paymentStatus === 'authorized') {
                try {
                  await loggedRazorpay.capturePayment(rzPay.paymentGatewayRef, amountPaise, {
                    userId: req.user?.id || null,
                    relatedEntity: 'payment',
                    relatedEntityId: rzPay._id
                  });
                  console.log('[CancelFlow] Razorpay payment captured for refund', { paymentId: rzPay.paymentGatewayRef, amountPaise });
                  paymentStatus = 'captured';
                } catch (capErr) {
                  console.warn('[Razorpay] capturePayment failed; skipping refund', capErr?.message || capErr);
                }
              }

              // Only refund when captured
              if (paymentStatus === 'captured') {
                const refundMode = process.env.ZOHO_REFUND_MODE || 'Bank Transfer';
                const fromAccountId = rzPay.deposit_to_account_id || process.env.ZOHO_REFUND_ACCOUNT_ID;
                const orgId = process.env.ZOHO_BOOKS_ORG_ID || process.env.ZOHO_ORG_ID;
                const booksBase = 'https://www.zohoapis.in/books/v3';
                const zohoPaymentId = rzPay.zoho_payment_id;
                if (!fromAccountId) {
                  console.warn('[CancelFlow] Zoho customer payment refund skipped: no from_account_id (set Payment.deposit_to_account_id or ZOHO_REFUND_ACCOUNT_ID)');
                } else if (!orgId) {
                  console.warn('[CancelFlow] Zoho customer payment refund skipped: missing organization id (ZOHO_BOOKS_ORG_ID or ZOHO_ORG_ID)');
                } else if (!zohoPaymentId) {
                  console.warn('[CancelFlow] Zoho customer payment refund skipped: missing zoho_payment_id on Payment');
                } else {
                  const refundBody = {
                    amount: Number((amountPaise / 100).toFixed(2)),
                    date: new Date().toISOString().slice(0, 10),
                    description: `Auto refund for booking ${String(booking._id)} | RZP refund ${rzPay.paymentGatewayRef}`,
                    refund_mode: refundMode,
                    from_account_id: fromAccountId,
                    reference_number: rzPay.paymentGatewayRef
                  };
                  const refundUrl = `${booksBase}/customerpayments/${zohoPaymentId}/refunds?organization_id=${orgId}`;
                  const zResp = await fetch(refundUrl, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Zoho-oauthtoken ${await getValidAccessToken()}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(refundBody)
                  });
                  const zData = await zResp.json().catch(() => ({}));
                  if (zResp.ok) {
                    const zohoRefundId = zData?.payment_refund?.payment_refund_id || zData?.payment_refund_id || zData?.refund?.refund_id || null;
                    console.log('[CancelFlow] Zoho customer payment refund recorded', { zoho_payment_id: zohoPaymentId, zoho_refund_id: zohoRefundId, amount: refundBody.amount });
                  } else {
                    console.warn('[CancelFlow] Zoho customer payment refund failed', { zoho_payment_id: zohoPaymentId, message: zData?.message || 'Unknown error' });
                  }
                }
              } else {
                console.warn('[CancelFlow] Razorpay refund skipped (payment not captured)', { paymentId: rzPay.paymentGatewayRef, status: paymentStatus });
              }
            }
          }
        }
      }
    } catch (rzErr) {
      console.warn('[Razorpay] Refund attempt failed on cancellation:', rzErr?.message || rzErr);
    }

    // Remove reserved slot from meeting room
    try {
      const roomId = booking.room?._id || booking.room;
      if (roomId) {
        const room = await MeetingRoom.findById(roomId);
        if (room) {
          room.reservedSlots = (room.reservedSlots || []).filter(slot => String(slot.bookingId) !== String(booking._id));
          await room.save();
          console.log('[CancelFlow] Reserved slot freed in room', { bookingId: String(booking._id), roomId: String(room._id) });
        }
      }
    } catch (_) {}

    console.log('[CancelFlow] Completed successfully', { bookingId: String(booking._id) });
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
      .populate("member", "firstName lastName email phone companyName")
      .populate("guest", "name email phone")
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
        hostClient: booking.client || undefined,
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

    // Best-effort: provision access for visitors now that one is added
    try {
      await provisionAccessForMeetingBooking({ bookingId: id });
      console.log('[MeetingAccess] Provisioned after adding visitor', { bookingId: String(id) });
    } catch (e) {
      console.warn('[MeetingAccess] Provision failed after addVisitorToBooking', e?.message || e);
    }

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
// Request or update discount on an existing booking
export const requestDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const { percent, reason, usingDefaultBuildingDiscount } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: "booking id is required" });
    if (percent == null) return res.status(400).json({ success: false, message: "percent is required" });

    const booking = await MeetingBooking.findById(id).populate('room');
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (["cancelled", "completed"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot request discount for a ${booking.status} booking` });
    }
    if (booking.payment?.method === 'credits') {
      return res.status(400).json({ success: false, code: "DISCOUNT_NOT_ALLOWED_WITH_CREDITS", message: "Discounts are not applicable when paying with credits" });
    }

    const pricing = await MeetingRoomPricing.findOne({ meetingRoom: booking.room._id }).lean();
    const cap = await resolveDiscountCap({ room: booking.room, pricing, usingDefaultBuildingDiscount });
    const requestedDiscountPercent = Number(percent);

    // Within cap -> auto-apply
    if (requestedDiscountPercent <= cap) {
      const dailyRate = booking.room?.pricing?.dailyRate || pricing?.dailyRate || 500;
      const totals = computeInvoiceTotals(dailyRate, requestedDiscountPercent);

      booking.usingDefaultBuildingDiscount = !!usingDefaultBuildingDiscount;
      booking.discountStatus = 'approved';
      booking.appliedDiscountPercent = requestedDiscountPercent;
      booking.discountAmount = totals.discountAmount;
      booking.requestedDiscountPercent = undefined;
      booking.requestedBy = undefined;
      booking.requestedReason = undefined;

      // Ensure invoice exists/updated
      if (!booking.invoice && booking.client) {
        const invoice = new Invoice({
          client: booking.client,
          type: 'regular',
          category: 'meeting_room',
          invoice_number: `MR-${Date.now()}`,
          line_items: [{
            description: `Meeting Room - ${booking.room.name} (Daily)`,
            quantity: 1,
            unitPrice: dailyRate,
            amount: dailyRate, // show gross amount in line item
            rate: dailyRate
          }],
          sub_total: totals.sub_total,
          discount: totals.discountAmount || 0,
          tax_total: totals.tax_total,
          total: totals.total,
          status: 'draft',
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await invoice.save();
        booking.invoice = invoice._id;
      } else if (booking.invoice) {
        // Update existing invoice
        await Invoice.findByIdAndUpdate(booking.invoice, {
          $set: {
            line_items: [{
              description: `Meeting Room - ${booking.room.name} (Daily)`,
              quantity: 1,
              unitPrice: dailyRate,
              amount: dailyRate,
              rate: dailyRate,
            }],
            sub_total: totals.sub_total,
            discount: totals.discountAmount || 0,
            tax_total: totals.tax_total,
            total: totals.total,
          }
        });
      }

      // Booking should be payment pending (cash/card)
      if (booking.status !== 'payment_pending') booking.status = 'payment_pending';
      await booking.save();

      const updated = await MeetingBooking.findById(id)
        .populate('room', 'name capacity amenities')
        .populate('invoice', 'invoice_number status total');
      return res.json({ success: true, data: updated });
    }

    // Over cap -> mark pending
    booking.usingDefaultBuildingDiscount = !!usingDefaultBuildingDiscount;
    booking.discountStatus = 'pending';
    booking.requestedDiscountPercent = requestedDiscountPercent;
    booking.requestedBy = req.user?.id || undefined;
    booking.requestedReason = reason;
    await booking.save();

    const updated = await MeetingBooking.findById(id)
      .populate('room', 'name capacity amenities')
      .populate('invoice', 'invoice_number status total');
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('requestDiscount error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedPercent, approvalNotes } = req.body || {};
    if (!id) return res.status(400).json({ success: false, code: "BOOKING_ID_REQUIRED", message: 'booking id is required' });
    const booking = await MeetingBooking.findById(id).populate('room');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.discountStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending discount request to approve' });
    }
    const pricing = await MeetingRoomPricing.findOne({ meetingRoom: booking.room._id }).lean();
    const dailyRate = booking.room?.pricing?.dailyRate || pricing?.dailyRate || 500;
    const pct = Math.max(0, Math.min(100, Number(approvedPercent ?? booking.requestedDiscountPercent ?? 0)));
    const totals = computeInvoiceTotals(dailyRate, pct);

    booking.discountStatus = 'approved';
    booking.appliedDiscountPercent = pct;
    booking.discountAmount = totals.discountAmount;
    booking.approvedBy = req.user?.id || undefined;
    booking.approvalNotes = approvalNotes;
    booking.approvedAt = new Date();
    booking.requestedDiscountPercent = undefined;
    booking.requestedBy = booking.requestedBy; // keep requester for history
    booking.requestedReason = undefined;

    // Ensure invoice exists or update
    if (!booking.invoice && booking.client) {
      const invoice = new Invoice({
        client: booking.client,
        type: 'regular',
        category: 'meeting_room',
        invoice_number: `MR-${Date.now()}`,
        line_items: [{
          description: `Meeting Room - ${booking.room.name} (Daily)`,
          quantity: 1,
          unitPrice: dailyRate,
          amount: dailyRate,
          rate: dailyRate,
        }],
        sub_total: totals.sub_total,
        discount: totals.discountAmount || 0,
        tax_total: totals.tax_total,
        total: totals.total,
        status: 'draft',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await invoice.save();
      booking.invoice = invoice._id;
    } else if (booking.invoice) {
      await Invoice.findByIdAndUpdate(booking.invoice, {
        $set: {
          line_items: [{
            description: `Meeting Room - ${booking.room.name} (Daily)`,
            quantity: 1,
            unitPrice: dailyRate,
            amount: dailyRate,
            rate: dailyRate,
          }],
          sub_total: totals.sub_total,
          discount: totals.discountAmount || 0,
          tax_total: totals.tax_total,
          total: totals.total,
        }
      });
    }

    if (booking.status !== 'payment_pending') booking.status = 'payment_pending';
    await booking.save();

    const updated = await MeetingBooking.findById(id)
      .populate('room', 'name capacity amenities')
      .populate('invoice', 'invoice_number status total');
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('approveDiscount error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalNotes } = req.body || {};
    if (!id) return res.status(400).json({ success: false, code: "BOOKING_ID_REQUIRED", message: 'booking id is required' });
    const booking = await MeetingBooking.findById(id).populate('room');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.discountStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending discount request to reject' });
    }

    booking.discountStatus = 'rejected';
    booking.approvedBy = req.user?.id || undefined;
    booking.approvalNotes = approvalNotes;
    booking.approvedAt = new Date();
    booking.appliedDiscountPercent = 0;
    booking.discountAmount = 0;

    // If no invoice exists yet, create base invoice so payment can proceed
    const pricing = await MeetingRoomPricing.findOne({ meetingRoom: booking.room._id }).lean();
    const dailyRate = booking.room?.pricing?.dailyRate || pricing?.dailyRate || 500;
    const totals = computeInvoiceTotals(dailyRate, 0);
    if (!booking.invoice && booking.client) {
      const invoice = new Invoice({
        client: booking.client,
        type: 'regular',
        category: 'meeting_room',
        invoice_number: `MR-${Date.now()}`,
        line_items: [{
          description: `Meeting Room - ${booking.room.name} (Daily)`,
          quantity: 1,
          unitPrice: dailyRate,
          amount: dailyRate,
          rate: dailyRate,
        }],
        sub_total: totals.sub_total,
        discount: 0,
        tax_total: totals.tax_total,
        total: totals.total,
        status: 'draft',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      await invoice.save();
      booking.invoice = invoice._id;
    }
    if (booking.status !== 'payment_pending') booking.status = 'payment_pending';
    await booking.save();

    const updated = await MeetingBooking.findById(id)
      .populate('room', 'name capacity amenities')
      .populate('invoice', 'invoice_number status total');
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('rejectDiscount error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listDiscountRequests = async (req, res) => {
  try {
    const { status = 'pending', building } = req.query || {};
    const filter = { discountStatus: status };
    if (building) {
      const rooms = await MeetingRoom.find({ building }).select('_id').lean();
      filter.room = { $in: rooms.map(r => r._id) };
    }
    const bookings = await MeetingBooking.find(filter)
      .populate('room', 'name capacity amenities building')
      .populate('requestedBy', 'name email')
      .populate('invoice', 'invoice_number status total')
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: bookings });
  } catch (error) {
    console.error('listDiscountRequests error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};