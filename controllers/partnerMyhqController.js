import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Building from "../models/buildingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Visitor from "../models/visitorModel.js";
import { recordCancellation } from "./cancelledBookingController.js";
import DayPass from "../models/dayPassModel.js";
import Guest from "../models/guestModel.js";
import DayPassDailyUsage from "../models/dayPassDailyUsageModel.js";
// ===== Utils =====
function hhmmToMinutes(hhmm = "09:00") {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function ampmToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  let [_, h, m, p] = match;
  h = parseInt(h, 10);
  m = parseInt(m, 10);
  if (p.toUpperCase() === "PM" && h < 12) h += 12;
  if (p.toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + m;
}
function toIST(date) {
  try {
    const d = new Date(date);
    // Format to IST string without timezone shifting by the parser later
    const s = d.toLocaleString('en-ZA', { timeZone: 'Asia/Kolkata', hour12: false }).replace(',', 'T').replace(' ', '');
    // en-ZA format is YYYY/MM/DD, HH:mm:ss
    const iso = s.replace(/\//g, '-') + 'Z';
    return new Date(iso);
  } catch (e) {
    return new Date(date);
  }
}
function startOfDayIST(date) {
  const d = toIST(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function endOfDayIST(date) {
  const d = toIST(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
// Helper: get minutes since midnight for a Date object that is ALREADY shifted to IST wall time (Z)
function minutesSinceMidnightWallTime(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
function mapStatusForPartner(status) {
  if (status === 'cancelled') return 'CANCELLED';
  return 'BOOKED'; // treat booked/payment_pending as BOOKED
}

// Helper: format a Date-like into an IST ISO-like string (YYYY-MM-DD HH:mm:ss IST)
function formatISTString(dateLike) {
  try {
    const d = new Date(dateLike);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} IST`;
  } catch (_) {
    return String(dateLike);
  }
}

// Helper: get IST day in YYYY-MM-DD
function formatYMDIST(dateLike) {
  const d = new Date(dateLike);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ===== Controllers =====
export async function issueToken(req, res) {
  try {
    const { clientId, clientSecret } = req.body || {};
    const expectedId = process.env.MYHQ_CLIENT_ID;
    const expectedSecret = process.env.MYHQ_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ status: 400, success: false, message: "Missing clientId or clientSecret" });
    }
    if (!expectedId || !expectedSecret || clientId !== expectedId || clientSecret !== expectedSecret) {
      return res.status(401).json({ status: 401, success: false, message: "Invalid clientId or clientSecret" });
    }
    const payload = {
      partner: 'myhq',
      scopes: ['read:centers', 'read:rooms', 'read:availability', 'write:bookings']
    };
    const secret = process.env.PARTNER_JWT_SECRET || process.env.JWT_SECRET || "ofis-square-secret-key";
    const expiresIn = 3600; // 1 hour
    const accessToken = jwt.sign(payload, secret, { expiresIn });
    return res.json({ status: 200, success: true, message: "Token Generated Successfully", data: { accessToken, expiresIn } });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function listCenters(req, res) {
  try {
    const buildings = await Building.find({ status: { $ne: 'inactive' } }).lean();
    const rooms = await MeetingRoom.aggregate([
      { $group: { _id: "$building", count: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } } } }
    ]);
    const countMap = new Map(rooms.map(r => [String(r._id), r.count]));
    const data = buildings.map(b => ({
      id: String(b._id),
      name: b.name,
      address: b.address,
      oppening_time: b.openingTime || "09:00:00",
      closing_time: b.closingTime || "19:00:00",
      city_id: null,
      city_name: b.city,
      products: {
        daypass: { isActive: Number(b.dayPassDailyCapacity || 0) > 0 },
        meeting_room: { isActive: (countMap.get(String(b._id)) || 0) > 0 }
      },
      image_gallery: (b.photos || []).flatMap(p => (p.images || []).map(img => img.url)).slice(0, 10)
    }));
    return res.json({ status: 1, message: "success", data });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function listRoomsInCenter(req, res) {
  try {
    const { centerId } = req.params;
    const building = await Building.findById(centerId).lean();
    if (!building) return res.status(404).json({ status: 404, success: false, message: "Center not found" });
    const rooms = await MeetingRoom.find({ building: centerId }).lean();
    const data = rooms.map(r => ({
      center_id: String(building._id),
      center_name: building.name,
      room_id: String(r._id),
      room_name: r.name,
      room_capacity: r.capacity,
      address: building.address,
      oppening_time: building.openingTime || "09:00:00",
      closing_time: building.closingTime || "19:00:00",
      city: building.city,
      isActive: r.status === 'active',
      images: r.images || [],
      other_details: {}
    }));
    return res.json({ status: 1, message: "success", data });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function bulkAvailabilities(req, res) {
  try {
    const { dates, room_ids } = req.body || {};
    if (!Array.isArray(dates) || !Array.isArray(room_ids) || !dates.length || !room_ids.length) {
      return res.status(400).json({ status: 400, success: false, message: "dates[] and room_ids[] are required" });
    }
    const rooms = await MeetingRoom.find({ _id: { $in: room_ids } }).populate('building', 'openingTime closingTime').lean();
    const roomById = new Map(rooms.map(r => [String(r._id), r]));

    // Preload bookings overlapping all requested dates
    const dayRanges = dates.map(d => ({ start: startOfDayIST(d), end: endOfDayIST(d) }));
    const globalStart = new Date(Math.min(...dayRanges.map(x => x.start.getTime())));
    const globalEnd = new Date(Math.max(...dayRanges.map(x => x.end.getTime())));
    const bookings = await MeetingBooking.find({
      room: { $in: room_ids },
      status: { $in: ['booked', 'payment_pending'] },
      start: { $lt: globalEnd },
      end: { $gt: globalStart },
    }).select('room start end').lean();
    const bookingsByRoom = new Map();
    for (const b of bookings) {
      const key = String(b.room);
      if (!bookingsByRoom.has(key)) bookingsByRoom.set(key, []);
      bookingsByRoom.get(key).push(b);
    }

    const data = [];
    for (const roomId of room_ids) {
      const room = roomById.get(String(roomId));
      if (!room) continue;
      const buildingOpen = hhmmToMinutes(room.building?.openingTime || '09:00');
      const buildingClose = hhmmToMinutes(room.building?.closingTime || '19:00');
      const daysOfWeek = room.availability?.daysOfWeek || [1, 2, 3, 4, 5];
      const blackoutDates = room.blackoutDates || [];

      for (const dateISO of dates) {
        const dayStart = startOfDayIST(dateISO);
        const dow = dayStart.getUTCDay();
        const isBlackout = blackoutDates.some(d => startOfDayIST(d).getTime() === dayStart.getTime());
        const slots = [];
        if (!daysOfWeek.includes(dow) || isBlackout || room.status !== 'active') {
          // Entire day closed
          slots.push({ startTimeInMinutes: 0, endTimeInMinutes: 1440, status: 'CLOSED' });
          data.push({ room_id: String(roomId), date: new Date(dateISO), availability: slots });
          continue;
        }

        // Initialize CLOSED everywhere
        const timeline = new Array(48).fill('CLOSED'); // 48 slots of 30 min
        // Mark AVAILABLE within building hours
        const startIdx = Math.max(0, Math.floor(buildingOpen / 30));
        const endIdx = Math.min(48, Math.ceil(buildingClose / 30));
        for (let i = startIdx; i < endIdx; i++) timeline[i] = 'AVAILABLE';
        // Mark SOLD_OUT for overlapping bookings
        const roomBookings = bookingsByRoom.get(String(roomId)) || [];
        for (const b of roomBookings) {
          // b.start and b.end are ALREADY IST wall time (09:30Z)
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);

          // Intersect with this day
          const s = Math.max(dayStart.getTime(), bStart.getTime());
          const e = Math.min(endOfDayIST(dayStart).getTime(), bEnd.getTime());
          if (e <= s) continue;

          const sMin = minutesSinceMidnightWallTime(new Date(s));
          const eMin = minutesSinceMidnightWallTime(new Date(e));
          const sIdx = Math.max(0, Math.floor(sMin / 30));
          const eIdx = Math.min(48, Math.ceil(eMin / 30));
          for (let i = sIdx; i < eIdx; i++) if (timeline[i] !== 'CLOSED') timeline[i] = 'SOLD_OUT';
        }

        // Mark SOLD_OUT for reservedSlots in the room document
        const reservedSlots = room.reservedSlots || [];
        const dateStrYMD = formatYMDIST(dateISO);
        for (const slot of reservedSlots) {
          const slotDateYMD = slot.dateISTYMD || (slot.date ? formatYMDIST(slot.date) : null);
          if (slotDateYMD === dateStrYMD) {
            const sMin = ampmToMinutes(slot.startTime);
            const eMin = ampmToMinutes(slot.endTime);
            const sIdx = Math.max(0, Math.floor(sMin / 30));
            const eIdx = Math.min(48, Math.ceil(eMin / 30));
            for (let i = sIdx; i < eIdx; i++) if (timeline[i] !== 'CLOSED') timeline[i] = 'SOLD_OUT';
          }
        }
        // Merge into ranges
        let cur = null; const ranges = [];
        for (let i = 0; i <= 48; i++) {
          const status = i < 48 ? timeline[i] : null;
          if (!cur) {
            if (status) cur = { start: i * 30, status };
          } else if (status !== cur.status) {
            ranges.push({ startTimeInMinutes: cur.start, endTimeInMinutes: i * 30, status: cur.status });
            cur = status ? { start: i * 30, status } : null;
          }
        }
        data.push({ room_id: String(roomId), date: new Date(dateISO), availability: ranges });
      }
    }

    return res.json({ status: 1, message: "success", data });
  } catch (e) {
    console.error('partner availability error:', e);
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function bookRoom(req, res) {
  try {
    const { room_id, reference_number, start_time, end_time, name, email, phone, guests } = req.body || {};
    if (!room_id || !reference_number || !start_time || !end_time) {
      return res.status(400).json({ status: 400, success: false, message: "Missing required fields" });
    }
    // Idempotency
    const existing = await MeetingBooking.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).select('_id').lean();
    if (existing) {
      return res.json({ status: 200, success: true, message: "Room Booked Successfully", data: { booking_id: String(existing._id) } });
    }

    const room = await MeetingRoom.findById(room_id).populate('building').lean();
    if (!room) return res.status(400).json({ status: 400, success: false, message: "Invalid value: room_id" });
    if (room.status !== 'active') return res.status(409).json({ status: 409, success: false, message: "Booking Slot is not available" });

    // Conflict check - logic remains same but execution moves into transaction below
    const start = toIST(start_time);
    const end = toIST(end_time);
    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.status(400).json({ status: 400, success: false, message: "Invalid start_time or end_time" });
    }

    // Create visitors (primary + guests)
    const visitorIds = [];
    try {
      const expectedVisitDate = new Date(start);
      const primary = await Visitor.create({
        name: (name || 'Guest').trim(),
        email: email?.trim(),
        phone: phone?.trim(),
        purpose: 'Meeting Room Booking',
        expectedVisitDate,
        expectedArrivalTime: start,
        expectedDepartureTime: end,
        building: room.building?._id || room.building,
        status: 'invited',
        externalSource: 'myhq',
        externalReferenceNumber: reference_number,
        bookingRole: 'primary'
      });
      visitorIds.push(primary._id);
      if (Array.isArray(guests)) {
        for (const g of guests) {
          if (!g || (!g.name && !g.email && !g.phone)) continue;
          const v = await Visitor.create({
            name: (g.name || 'Guest').trim(),
            email: g.email?.trim(),
            phone: g.phone?.trim(),
            purpose: 'Meeting Room Booking',
            expectedVisitDate,
            expectedArrivalTime: start,
            expectedDepartureTime: end,
            building: room.building?._id || room.building,
            status: 'invited',
            externalSource: 'myhq',
            externalReferenceNumber: reference_number,
            bookingRole: 'guest'
          });
          visitorIds.push(v._id);
        }
      }
    } catch (e) {
      // Non-fatal
      console.error('myhq visitor create error', e?.message);
    }

    // Create booking ATOMICALLY via transaction
    let booking;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Within building hours and allowed days (Final check inside lock)
        const openM = hhmmToMinutes(room.building?.openingTime || '09:00');
        const closeM = hhmmToMinutes(room.building?.closingTime || '19:00');
        const sMin = minutesSinceMidnightWallTime(start);
        const eMin = minutesSinceMidnightWallTime(end);

        const dow = start.getUTCDay();
        const allowedDays = room.availability?.daysOfWeek || [1, 2, 3, 4, 5];
        if (!allowedDays.includes(dow)) throw new Error("CONFLICT_DAY");

        if (sMin < openM || eMin > closeM) throw new Error("CONFLICT_HOURS");

        // 2. Blackout
        const dayStr = start.toISOString().slice(0, 10);
        const blackout = (room.blackoutDates || []).some(d => new Date(d).toISOString().slice(0, 10) === dayStr);
        if (blackout) throw new Error("CONFLICT_BLACKOUT");

        // 3. Final overlap check inside transaction
        const overlap = await MeetingBooking.findOne({
          room: room._id,
          status: { $in: ['booked', 'payment_pending'] },
          start: { $lt: end },
          end: { $gt: start },
        }).session(session).select('_id').lean();

        if (overlap) throw new Error("CONFLICT_OVERLAP");

        // 4. Check for reference number double-booking just in case
        const refDup = await MeetingBooking.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).session(session).select('_id').lean();
        if (refDup) throw new Error("CONFLICT_IDEMPOTENCY");

        // 5. Create the booking
        const [created] = await MeetingBooking.create([{
          room: room._id,
          start,
          end,
          visitors: visitorIds,
          status: 'booked',
          externalSource: 'myhq',
          referenceNumber: reference_number,
          currency: 'INR',
        }], { session });

        booking = created;
      });
    } catch (err) {
      if (err.message === "CONFLICT_DAY" || err.message === "CONFLICT_BLACKOUT" || err.message === "CONFLICT_OVERLAP") {
        return res.status(409).json({ status: 409, success: false, message: "Booking Slot is not available" });
      }
      if (err.message === "CONFLICT_HOURS") {
        return res.status(400).json({ status: 400, success: false, message: `Booking must be within operating hours ${(room.building?.openingTime || '09:00')}-${(room.building?.closingTime || '19:00')} IST` });
      }
      if (err.message === "CONFLICT_IDEMPOTENCY") {
        // Fallback for immediate race if findOne above somehow missed it but transaction caught it
        const fallback = await MeetingBooking.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).select('_id').lean();
        return res.json({ status: 200, success: true, message: "Room Booked Successfully", data: { booking_id: String(fallback._id) } });
      }
      throw err;
    } finally {
      session.endSession();
    }

    // Add reserved slot to room document
    try {
      const r = await MeetingRoom.findById(room._id);
      const startTimeStr = toIST(start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      const endTimeStr = toIST(end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      const istYmd = formatYMDIST(start);
      const utcMidnightOfIstDay = new Date(`${istYmd}T00:00:00.000Z`);
      r.reservedSlots.push({
        // Store UTC midnight of the IST day for visual consistency in DB tools
        date: utcMidnightOfIstDay,
        startTime: startTimeStr,
        endTime: endTimeStr,
        bookingId: booking._id,
        // denormalized IST day string for clarity in UIs/inspectors
        dateISTYMD: istYmd
      });
      await r.save();
    } catch (e) {
      console.error('myhq reserved slot push error', e?.message);
    }

    return res.json({ status: 200, success: true, message: "Room Booked Successfully", data: { booking_id: String(booking._id) } });
  } catch (e) {
    console.error('myhq book error:', e);
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function getBookingDetails(req, res) {
  try {
    const booking = await MeetingBooking.findById(req.params.id)
      .populate('room', 'name')
      .populate('visitors', 'name email phone bookingRole buildingAccess')
      .lean();
    if (!booking) return res.status(404).json({ status: 404, success: false, message: "Invalid Booking ID" });

    const primary = (booking.visitors || []).find(v => v.bookingRole === 'primary');
    const guests = (booking.visitors || []).filter(v => v.bookingRole === 'guest').map(v => ({ name: v.name, email: v.email, phone: v.phone }));
    return res.json({
      status: 200,
      success: true,
      message: "Room Booked Successfully",
      data: {
        booking_id: String(booking._id),
        status: mapStatusForPartner(booking.status),
        room_id: String(booking.room),
        reference_number: booking.referenceNumber,
        start_time: formatISTString(booking.start),
        end_time: formatISTString(booking.end),
        name: primary?.name,
        email: primary?.email,
        phone: primary?.phone,
        guests,
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function cancelBooking(req, res) {
  try {
    const booking = await MeetingBooking.findById(req.params.id)
      .populate({ path: 'room', populate: { path: 'building' } });

    if (!booking) return res.status(404).json({ status: 404, success: false, message: "Invalid Booking ID" });
    if (booking.status === 'cancelled') {
      return res.status(409).json({ status: 409, success: false, message: "Already cancelled" });
    }
    const createdAt = new Date(booking.createdAt || booking.start);
    const now = toIST(new Date());

    const building = booking.room?.building;

    // Configurable windows (prefer building settings, fallback to env)
    const graceMinutes = typeof building?.meetingCancellationGraceMinutes === 'number'
      ? building.meetingCancellationGraceMinutes
      : parseInt(process.env.MYHQ_CANCELLATION_GRACE_MINUTES || process.env.BOOKING_CANCELLATION_GRACE_MINUTES || '5', 10);

    // Allow immediate grace window from creation
    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;

    if (!withinGrace) {
      return res.status(403).json({ status: 403, success: false, message: "Outside Booking Cancellation Window (Grace Period Expired)" });
    }

    booking.status = 'cancelled';
    await booking.save();

    // Record cancellation snapshot (idempotent)
    try {
      const reason = req.body?.reason || req.query?.reason;
      await recordCancellation(booking, { cancelledBy: 'partner:myhq', cancellationReason: reason });
    } catch (e) {
      console.error('Failed to record cancelled booking snapshot:', e?.message);
    }

    // Remove reserved slot
    try {
      const room = await MeetingRoom.findById(booking.room._id || booking.room);
      if (room) {
        room.reservedSlots = (room.reservedSlots || []).filter(slot => String(slot.bookingId) !== String(booking._id));
        await room.save();
      }
    } catch (e) { }

    return res.json({ status: 200, success: true, message: "Booking Cancelled Successfully", data: { booking_id: String(booking._id), status: 'CANCELLED' } });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Buildings list =====
export async function listDayPassBuildings(req, res) {
  try {
    const buildings = await Building.find({ status: { $ne: 'inactive' } }).lean();
    const data = buildings
      .filter(b => Number(b.dayPassDailyCapacity || 0) > 0)
      .map(b => ({
        building_id: String(b._id),
        name: b.name,
        address: b.address,
        oppening_time: b.openingTime || '09:00:00',
        closing_time: b.closingTime || '19:00:00',
        city_id: null,
        city_name: b.city,
        image_gallery: (b.photos || []).flatMap(p => (p.images || []).map(img => img.url)).slice(0, 5)
      }));
    return res.json({ status: true, data });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

export async function buildingDayPassAvailability(req, res) {
  try {
    const { buildingId } = req.params;
    const { dates } = req.body || {};
    if (!Array.isArray(dates) || !dates.length) {
      return res.status(400).json({ status: 400, success: false, message: 'dates[] are required' });
    }

    const b = await Building.findById(buildingId).lean();
    if (!b) return res.status(404).json({ status: 404, success: false, message: 'Building not found' });

    // Capacity configured per building
    const totalCapacity = Number(b.dayPassDailyCapacity || 0);

    const data = [];
    for (const dateISO of dates) {
      const dayStart = startOfDayIST(dateISO);
      let bookedSeats = 0;

      try {
        // Prefer daily usage counter (fast path)
        const usage = await DayPassDailyUsage.findOne({ building: b._id, date: dayStart }).lean();
        if (usage && typeof usage.bookedCount === 'number') {
          bookedSeats = Number(usage.bookedCount || 0);
        } else {
          // Fallback to counting passes for backward compatibility
          const activeStatuses = ['issued', 'invited', 'active', 'checked_in'];
          const passes = await DayPass.find({
            building: b._id,
            date: { $gte: dayStart, $lte: endOfDayIST(dayStart) },
            status: { $in: activeStatuses },
          }).select('numberOfGuests').lean();
          bookedSeats = (passes || []).reduce((sum, p) => sum + Number(p.numberOfGuests || 1), 0);
        }
      } catch (_) { }

      const availableSeats = Math.max(0, totalCapacity - bookedSeats);
      const availability = totalCapacity > 0 && availableSeats > 0
        ? { status: 'Available', availableSeats }
        : { status: 'Closed' };
      data.push({ building_id: String(b._id), date: new Date(dateISO), availability });
    }

    return res.json({ status: 1, message: 'success', data });
  } catch (e) {
    console.error('daypass building availability error:', e);
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Booking (building-level, no inventory) =====
export async function bookDayPass(req, res) {
  try {
    const { building_id, reference_number, date_of_booking, name, email, phone } = req.body || {};
    if (!building_id || !reference_number || !date_of_booking) {
      return res.status(400).json({ status: 400, success: false, message: 'Missing required fields' });
    }

    // Idempotency
    const existing = await DayPass.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).select('_id').lean();
    if (existing) {
      return res.json({ success: true, message: 'Booked Successfully', data: { booking_id: String(existing._id) } });
    }

    const building = await Building.findById(building_id).lean();
    if (!building) return res.status(400).json({ status: 400, success: false, message: 'Invalid value: building_id' });

    // Building-level capacity
    const totalCapacity = Number(building.dayPassDailyCapacity || 0);
    if (totalCapacity <= 0) return res.status(409).json({ status: 409, success: false, message: 'Booking is not available' });

    const passDate = startOfDayIST(date_of_booking);

    // Atomically reserve a slot and create the pass via transaction
    let dayPass;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Idempotency check inside transaction
        const refDup = await DayPass.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).session(session).select('_id').lean();
        if (refDup) throw new Error("CONFLICT_IDEMPOTENCY");

        // 2. Find or create guest (inside transaction for safety)
        let guest = null;
        if (email) guest = await Guest.findOne({ email }).session(session).lean();
        if (!guest && phone) guest = await Guest.findOne({ phone }).session(session).lean();
        if (!guest) {
          const [newGuest] = await Guest.create([{ name: name || 'Guest', email: email || undefined, phone: phone || undefined }], { session });
          guest = newGuest;
        }

        // 3. Determine price
        let price = Number(building.openSpacePricing || 0);
        if (!price || Number.isNaN(price)) {
          throw new Error("MISSING_PRICE");
        }

        // 4. Atomically reserve a slot for this building/date
        const usage = await DayPassDailyUsage.findOneAndUpdate(
          { building: building._id, date: passDate },
          { $inc: { bookedCount: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );

        if (Number(usage.bookedCount || 0) > totalCapacity) {
          throw new Error("CONFLICT_CAPACITY");
        }

        // 5. Create the DayPass
        const [created] = await DayPass.create([{
          customer: guest._id,
          member: null,
          building: building._id,
          bundle: null,
          date: passDate,
          visitDate: passDate,
          bookingFor: 'self',
          expiresAt: endOfDayIST(passDate),
          price,
          currency: 'INR',
          status: 'issued',
          visitorName: name,
          visitorEmail: email,
          visitorPhone: phone,
          numberOfGuests: 1,
          externalSource: 'myhq',
          referenceNumber: reference_number,
        }], { session });

        dayPass = created;
      });
    } catch (err) {
      if (err.message === "CONFLICT_IDEMPOTENCY") {
        const fallback = await DayPass.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).select('_id').lean();
        return res.json({ success: true, message: 'Booked Successfully', data: { booking_id: String(fallback._id) } });
      }
      if (err.message === "CONFLICT_CAPACITY") {
        return res.status(409).json({ status: 409, success: false, message: 'Booking is not available' });
      }
      if (err.message === "MISSING_PRICE") {
        return res.status(400).json({ status: 400, success: false, message: 'Price not configured for day pass' });
      }
      throw err;
    } finally {
      session.endSession();
    }

    return res.json({ success: true, message: 'Booked Successfully', data: { booking_id: String(dayPass._id) } });
  } catch (e) {
    console.error('myhq daypass book error:', e);
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Cancellation =====
export async function cancelDayPassBooking(req, res) {
  try {
    const { id } = req.params;
    const pass = await DayPass.findById(id).populate('building');
    if (!pass) return res.status(404).json({ status: 404, success: false, message: 'Invalid Booking ID' });
    const now = toIST(new Date());
    const createdAt = toIST(pass.createdAt || pass.date);
    if (pass.externalSource !== 'myhq') {
      return res.status(400).json({ status: 400, success: false, message: 'Not a partner booking' });
    }
    if (pass.status === 'cancelled') {
      return res.status(409).json({ status: 409, success: false, message: 'Booking Already Cancelled' });
    }

    const building = pass.building;
    const graceMinutes = typeof building?.meetingCancellationGraceMinutes === 'number'
      ? building.meetingCancellationGraceMinutes
      : parseInt(process.env.MYHQ_CANCELLATION_GRACE_MINUTES || '5', 10);

    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;

    if (!withinGrace) {
      return res.status(403).json({ status: 403, success: false, message: 'Outside Booking Cancellation Window (Grace Period Expired)' });
    }

    pass.status = 'cancelled';
    await pass.save();

    // Record cancellation snapshot (idempotent)
    try {
      const reason = req.body?.reason || req.query?.reason;
      await recordCancellation(pass, { cancelledBy: 'partner:myhq', cancellationReason: reason });
    } catch (e) {
      console.error('Failed to record cancelled daypass snapshot:', e?.message);
    }

    // decrement the reserved usage slot
    try {
      const d = startOfDayIST(pass.date);
      await DayPassDailyUsage.updateOne({ building: pass.building._id || pass.building, date: d }, { $inc: { bookedCount: -1 } });
    } catch (_) { }

    return res.json({ status: 200, success: true, message: 'Booking Cancelled Successfully', data: { booking_id: String(pass._id), status: 'CANCELLED' } });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}
