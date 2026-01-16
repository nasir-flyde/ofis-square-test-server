import jwt from "jsonwebtoken";
import Building from "../models/buildingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Visitor from "../models/visitorModel.js";
import { recordCancellation } from "./cancelledBookingController.js";
import DayPass from "../models/dayPassModel.js";
import Guest from "../models/guestModel.js";

// ===== Utils =====
function hhmmToMinutes(hhmm = "09:00") {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function toIST(date) {
  try {
    return new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  } catch (e) {
    return new Date(date);
  }
}
function startOfDayIST(date) {
  const d = toIST(date);
  d.setHours(0,0,0,0);
  return d;
}
function endOfDayIST(date) {
  const d = toIST(date);
  d.setHours(23,59,59,999);
  return d;
}
function minutesSinceMidnightIST(date) {
  const d = toIST(date);
  return d.getHours() * 60 + d.getMinutes();
}
function mapStatusForPartner(status) {
  if (status === 'cancelled') return 'CANCELLED';
  return 'BOOKED'; // treat booked/payment_pending as BOOKED
}

// Helper: format a Date-like into an IST ISO-like string (YYYY-MM-DD HH:mm:ss IST)
function formatISTString(dateLike) {
  try {
    const d = toIST(dateLike);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} IST`;
  } catch (_) {
    return String(dateLike);
  }
}

// Helper: get IST day in YYYY-MM-DD
function formatYMDIST(dateLike) {
  const d = toIST(dateLike);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
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
      scopes: ['read:centers','read:rooms','read:availability','write:bookings']
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
        daypass: { isActive: false },
        meeting_room: { isActive: (countMap.get(String(b._id)) || 0) > 0 }
      },
      image_gallery: []
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
      const daysOfWeek = room.availability?.daysOfWeek || [1,2,3,4,5];
      const blackoutDates = room.blackoutDates || [];

      for (const dateISO of dates) {
        const dayStart = startOfDayIST(dateISO);
        const dow = dayStart.getDay();
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
          // Intersect with this day
          const s = Math.max(dayStart.getTime(), toIST(b.start).getTime());
          const e = Math.min(endOfDayIST(dayStart).getTime(), toIST(b.end).getTime());
          if (e <= s) continue;
          const sMin = minutesSinceMidnightIST(s);
          const eMin = minutesSinceMidnightIST(e);
          const sIdx = Math.max(0, Math.floor(sMin / 30));
          const eIdx = Math.min(48, Math.ceil(eMin / 30));
          for (let i = sIdx; i < eIdx; i++) if (timeline[i] !== 'CLOSED') timeline[i] = 'SOLD_OUT';
        }
        // Merge into ranges
        let cur = null; const ranges = [];
        for (let i = 0; i <= 48; i++) {
          const status = i < 48 ? timeline[i] : null;
          if (!cur) {
            if (status) cur = { start: i*30, status };
          } else if (status !== cur.status) {
            ranges.push({ startTimeInMinutes: cur.start, endTimeInMinutes: i*30, status: cur.status });
            cur = status ? { start: i*30, status } : null;
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

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.status(400).json({ status: 400, success: false, message: "Invalid start_time or end_time" });
    }
    // Within building hours
    const openM = hhmmToMinutes(room.building?.openingTime || '09:00');
    const closeM = hhmmToMinutes(room.building?.closingTime || '19:00');
    const sMin = minutesSinceMidnightIST(start);
    const eMin = minutesSinceMidnightIST(end);
    if (sMin < openM || eMin > closeM) {
      return res.status(400).json({ status: 400, success: false, message: `Booking must be within operating hours ${(room.building?.openingTime||'09:00')}-${(room.building?.closingTime||'19:00')} IST` });
    }
    // Blackout
    const dayStr = start.toISOString().slice(0,10);
    const blackout = (room.blackoutDates || []).some(d => new Date(d).toISOString().slice(0,10) === dayStr);
    if (blackout) return res.status(409).json({ status: 409, success: false, message: "Booking Slot is not available" });
    // Conflict
    const overlap = await MeetingBooking.findOne({
      room: room._id,
      status: { $in: ['booked','payment_pending'] },
      start: { $lt: end },
      end: { $gt: start },
    }).select('_id').lean();
    if (overlap) return res.status(409).json({ status: 409, success: false, message: "Booking Slot is not available" });

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

    // Create booking (payment pending by default for cash-like flow)
    const booking = await MeetingBooking.create({
      room: room._id,
      start,
      end,
      visitors: visitorIds,
      status: 'booked',
      externalSource: 'myhq',
      referenceNumber: reference_number,
      currency: 'INR',
    });

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
      .populate('visitors', 'name email phone bookingRole')
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
    const booking = await MeetingBooking.findById(req.params.id).populate('room');
    if (!booking) return res.status(404).json({ status: 404, success: false, message: "Invalid Booking ID" });
    if (booking.status === 'cancelled') {
      return res.status(409).json({ status: 409, success: false, message: "Already cancelled" });
    }
    const createdAt = new Date(booking.createdAt || booking.start);
    const now = new Date();

    // Configurable windows
    const graceMinutes = parseInt(process.env.MYHQ_CANCELLATION_GRACE_MINUTES || process.env.BOOKING_CANCELLATION_GRACE_MINUTES || '5', 10);
    const cutoffMinutes = parseInt(process.env.MYHQ_CANCELLATION_CUTOFF_MINUTES || process.env.BOOKING_CANCELLATION_CUTOFF_MINUTES || '60', 10);

    // Allow immediate grace window from creation
    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;

    // Allow cancellation until cutoff before the booking start (IST-safe via toIST)
    const startIST = toIST(booking.start);
    const cutoffTime = new Date(startIST.getTime() - cutoffMinutes * 60 * 1000);
    const beforeCutoff = now.getTime() < cutoffTime.getTime();

    if (!(withinGrace || beforeCutoff)) {
      return res.status(403).json({ status: 403, success: false, message: "Outside Booking Cancellation Window" });
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
    } catch (e) {}

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
      .filter(b => Array.isArray(b.dayPassInventories) && b.dayPassInventories.some(inv => inv?.isActive && (inv?.capacity ?? 0) > 0))
      .map(b => ({
        building_id: String(b._id),
        name: b.name,
        address: b.address,
        oppening_time: b.openingTime || '09:00:00',
        closing_time: b.closingTime || '19:00:00',
        city_id: null,
        city_name: b.city,
        image_gallery: (b.photos || []).map(p => p.imageUrl).slice(0, 5)
      }));
    return res.json({ status: true, data });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Inventories in Building =====
export async function listDayPassInventories(req, res) {
  try {
    const { buildingId } = req.params;
    const b = await Building.findById(buildingId).lean();
    if (!b) return res.status(404).json({ status: 404, success: false, message: 'Building not found' });
    const inventories = Array.isArray(b.dayPassInventories) ? b.dayPassInventories : [];
    const data = inventories.map(inv => ({
      building_id: String(b._id),
      inventory_type: inv.inventoryType,
      inventory_id: String(inv._id),
      seating_capacity: inv.capacity || 0,
      isActive: !!inv.isActive,
      other_details: {
        images: Array.isArray(inv.images) ? inv.images : [],
        price: inv.price ?? null,
        rackPrice: inv.rackPrice ?? null,
      }
    }));
    return res.json({ status: true, data });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Bulk availability =====
export async function bulkDayPassAvailability(req, res) {
  try {
    const { dates, inventory_ids } = req.body || {};
    if (!Array.isArray(dates) || !Array.isArray(inventory_ids) || !dates.length || !inventory_ids.length) {
      return res.status(400).json({ status: 400, success: false, message: 'dates[] and inventory_ids[] are required' });
    }

    // Build a lookup of inventory by id and parent building
    const buildings = await Building.find({ 'dayPassInventories._id': { $in: inventory_ids } }).lean();
    const invMap = new Map();
    for (const b of buildings) {
      for (const inv of (b.dayPassInventories || [])) {
        const key = String(inv._id);
        if (inventory_ids.includes(key)) {
          invMap.set(key, { inv, building: b });
        }
      }
    }

    const activeStatuses = ['issued', 'invited', 'active', 'checked_in', 'checked_out'];
    const data = [];

    for (const invId of inventory_ids) {
      const pair = invMap.get(String(invId));
      if (!pair) continue;
      const { inv } = pair;

      for (const dateISO of dates) {
        const dayStart = startOfDayIST(dateISO);
        const dayEnd = endOfDayIST(dateISO);
        // Query all passes for this inventory/date
        const passes = await DayPass.find({
          inventoryId: String(inv._id),
          date: { $gte: dayStart, $lte: dayEnd },
          status: { $in: activeStatuses }
        }).select('numberOfGuests').lean();

        const bookedSeats = (passes || []).reduce((sum, p) => sum + (Number(p.numberOfGuests || 1)), 0);
        const capacity = Number(inv.capacity || 0);
        const availableSeats = Math.max(0, capacity - bookedSeats);
        const availability = availableSeats > 0
          ? { status: 'Available', availableSeats }
          : { status: 'Closed' };

        data.push({ inventory_id: String(inv._id), date: new Date(dateISO), availability });
      }
    }

    return res.json({ status: 1, message: 'success', data });
  } catch (e) {
    console.error('daypass availability error:', e);
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}

// ===== Day Pass: Booking =====
export async function bookDayPass(req, res) {
  try {
    const { inventory_id, building_id, reference_number, date_of_booking, name, email, phone } = req.body || {};
    if (!inventory_id || !building_id || !reference_number || !date_of_booking) {
      return res.status(400).json({ status: 400, success: false, message: 'Missing required fields' });
    }

    // Idempotency
    const existing = await DayPass.findOne({ externalSource: 'myhq', referenceNumber: reference_number }).select('_id').lean();
    if (existing) {
      return res.json({ success: true, message: 'Booked Successfully', data: { booking_id: String(existing._id) } });
    }

    const building = await Building.findById(building_id).lean();
    if (!building) return res.status(400).json({ status: 400, success: false, message: 'Invalid value: building_id' });
    const inv = (building.dayPassInventories || []).find(v => String(v._id) === String(inventory_id));
    if (!inv) return res.status(400).json({ status: 400, success: false, message: 'Invalid value: inventory_id' });
    if (!inv.isActive) return res.status(409).json({ status: 409, success: false, message: 'Booking is not available' });

    const passDate = startOfDayIST(date_of_booking);
    const dayStart = new Date(passDate);
    const dayEnd = endOfDayIST(passDate);

    // Capacity check
    const activeStatuses = ['issued', 'invited', 'active', 'checked_in', 'checked_out'];
    const passes = await DayPass.find({
      inventoryId: String(inv._id),
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: activeStatuses }
    }).select('numberOfGuests').lean();
    const bookedSeats = (passes || []).reduce((sum, p) => sum + (Number(p.numberOfGuests || 1)), 0);
    const capacity = Number(inv.capacity || 0);
    if (bookedSeats >= capacity) {
      return res.status(409).json({ status: 409, success: false, message: 'Booking is not available' });
    }

    // Find or create guest
    let guest = null;
    if (email) guest = await Guest.findOne({ email }).lean();
    if (!guest && phone) guest = await Guest.findOne({ phone }).lean();
    if (!guest) {
      guest = await Guest.create({ name: name || 'Guest', email: email || undefined, phone: phone || undefined });
    }

    // Build basic day pass details
    const expiresAt = endOfDayIST(passDate);
    const price = Number(inv.price || building.openSpacePricing || 0);
    const dayPass = await DayPass.create({
      customer: guest._id,
      member: null,
      building: building._id,
      bundle: null,
      inventoryId: String(inv._id),
      date: passDate,
      visitDate: passDate,
      bookingFor: 'self',
      expiresAt,
      price,
      currency: 'INR',
      status: 'issued',
      visitorName: name,
      visitorEmail: email,
      visitorPhone: phone,
      numberOfGuests: 1,
      externalSource: 'myhq',
      referenceNumber: reference_number,
    });

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
    if (pass.externalSource !== 'myhq') {
      return res.status(400).json({ status: 400, success: false, message: 'Not a partner booking' });
    }
    if (pass.status === 'cancelled') {
      return res.status(409).json({ status: 409, success: false, message: 'Booking Already Cancelled' });
    }

    const now = new Date();
    const createdAt = new Date(pass.createdAt);
    const graceMinutes = parseInt(process.env.MYHQ_CANCELLATION_GRACE_MINUTES || '5', 10);
    const cutoffMinutes = parseInt(process.env.MYHQ_CANCELLATION_CUTOFF_MINUTES || '60', 10);
    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;

    // Determine the effective start time on the pass date using building openingTime
    const baseDate = startOfDayIST(pass.date || now);
    const [hh, mm] = String(pass.building?.openingTime || '09:00').split(':').map(Number);
    const startTime = new Date(baseDate);
    startTime.setHours(hh || 9, mm || 0, 0, 0);
    const cutoffTime = new Date(startTime.getTime() - cutoffMinutes * 60 * 1000);
    const beforeCutoff = now.getTime() < cutoffTime.getTime();

    if (!(withinGrace || beforeCutoff)) {
      return res.status(403).json({ status: 403, success: false, message: 'Outside Booking Cancellation Window' });
    }

    pass.status = 'cancelled';
    await pass.save();

    return res.json({ status: 200, success: true, message: 'Booking Cancelled Successfully', data: { booking_id: String(pass._id), status: 'CANCELLED' } });
  } catch (e) {
    return res.status(500).json({ status: 500, success: false, message: e.message });
  }
}
