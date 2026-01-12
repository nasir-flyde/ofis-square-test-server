import CancelledBooking from "../models/cancelledBookingModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";

// Record a cancelled booking (idempotent by unique index on booking)
export async function recordCancellation(bookingInput, { cancelledBy = "system", cancellationReason } = {}) {
  // bookingInput can be a booking document or an ID
  let booking = bookingInput;
  if (!booking || !booking._id) {
    booking = await MeetingBooking.findById(bookingInput).populate({ path: 'room', select: 'building' }).lean();
  } else if (typeof booking.toObject === 'function') {
    booking = booking.toObject();
  }

  if (!booking) throw new Error("Booking not found to record cancellation");

  // Derive building id if available
  let buildingId = undefined;
  try {
    if (booking.room) {
      const room = await MeetingRoom.findById(booking.room).select('building').lean();
      buildingId = room?.building;
    }
  } catch (_) {}

  const doc = {
    booking: booking._id,
    room: booking.room,
    building: buildingId,
    start: booking.start,
    end: booking.end,
    statusBefore: booking.status,
    statusAfter: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy,
    cancellationReason,
    externalSource: booking.externalSource,
    referenceNumber: booking.referenceNumber,
    snapshot: {
      currency: booking.currency,
      amount: booking.amount,
      payment: booking.payment,
      visitorsCount: Array.isArray(booking.visitors) ? booking.visitors.length : undefined,
      notes: booking.notes,
    }
  };

  try {
    // Upsert-like behavior: ignore duplicate if already recorded
    const created = await CancelledBooking.create(doc);
    return created;
  } catch (e) {
    if (e && e.code === 11000) {
      // Duplicate (already recorded) -> fetch existing
      return await CancelledBooking.findOne({ booking: booking._id });
    }
    throw e;
  }
}

// Optional: List cancelled bookings
export async function listCancelledBookings(req, res) {
  try {
    const { room, building, from, to, externalSource } = req.query || {};
    const filter = {};
    if (room) filter.room = room;
    if (building) filter.building = building;
    if (externalSource) filter.externalSource = externalSource;
    if (from || to) {
      filter.cancelledAt = filter.cancelledAt || {};
      if (from) filter.cancelledAt.$gte = new Date(from);
      if (to) filter.cancelledAt.$lte = new Date(to);
    }
    const data = await CancelledBooking.find(filter).sort({ cancelledAt: -1 });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Optional: Get a single cancelled booking by original booking id
export async function getCancelledBookingByBookingId(req, res) {
  try {
    const { bookingId } = req.params;
    if (!bookingId) return res.status(400).json({ success: false, message: 'bookingId is required' });
    const data = await CancelledBooking.findOne({ booking: bookingId });
    if (!data) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
