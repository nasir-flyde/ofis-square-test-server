import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import path from "path";
import MatrixDevice from "../models/matrixDeviceModel.js";

// Create a meeting room
export const createRoom = async (req, res) => {
  try {
    const roomData = { ...req.body };
    // Validate matrix devices if provided
    if (Array.isArray(roomData.matrixDeviceIds) && roomData.matrixDeviceIds.length > 0) {
      const buildingId = roomData.building;
      if (!buildingId) return res.status(400).json({ success: false, message: 'building is required when attaching matrix devices' });
      const devices = await MatrixDevice.find({ _id: { $in: roomData.matrixDeviceIds } }).select('_id buildingId status').lean();
      const foundIds = new Set(devices.map(d => String(d._id)));
      const missing = roomData.matrixDeviceIds.map(String).filter(x => !foundIds.has(x));
      if (missing.length) return res.status(400).json({ success: false, message: `Unknown matrix devices: ${missing.join(', ')}` });
      const invalid = devices.filter(d => String(d.buildingId) !== String(buildingId));
      if (invalid.length) return res.status(400).json({ success: false, message: 'Matrix devices must belong to the same building as the meeting room' });
      const inactive = devices.filter(d => d.status !== 'active');
      if (inactive.length) return res.status(400).json({ success: false, message: 'Matrix devices must be active' });
      roomData.matrixDevices = roomData.matrixDeviceIds;
      delete roomData.matrixDeviceIds;
    }
    
    // Handle uploaded images with ImageKit
    if (req.files && req.files.length > 0) {
      const imageUploadPromises = req.files.map(async (file) => {
        try {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `meeting-room-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`,
            folder: '/meeting-rooms'
          });
          return result.url;
        } catch (uploadError) {
          console.error('ImageKit upload error:', uploadError);
          throw uploadError;
        }
      });
      
      roomData.images = await Promise.all(imageUploadPromises);
    }
    
    const room = await MeetingRoom.create(roomData);
    await logCRUDActivity(req, 'CREATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      buildingId: room.building,
      capacity: room.capacity,
      dailyRate: room.pricing?.dailyRate,
      imagesCount: room.images?.length || 0
    });
    return res.status(201).json({ success: true, data: room });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// List meeting rooms with filters
export const listRooms = async (req, res) => {
  try {
    const { building, status, minCapacity, amenity, q } = req.query || {};
    const filter = {};
    if (building) filter.building = building;
    if (status) filter.status = status;
    if (minCapacity) filter.capacity = { $gte: Number(minCapacity) };
    if (amenity) filter.amenities = { $in: [amenity] };
    if (q) filter.name = { $regex: q, $options: "i" };

    const meetingRooms = await MeetingRoom.find(filter)
      .populate('building', 'name address city')
      .sort({ createdAt: -1 });

    // Manual logging removed - handled by middleware for non-GET requests only

    return res.json({
      success: true,
      data: meetingRooms,
      count: meetingRooms.length
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get a room by ID
export const getRoomById = async (req, res) => {
  try {
    const id = req.params.id;
    const oldMeetingRoom = await MeetingRoom.findById(id);
    const meetingRoom = await MeetingRoom.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    ).populate('building', 'name address city');

    if (!meetingRoom) {
      return res.status(404).json({
        success: false,
        message: 'Meeting room not found'
      });
    }

    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', id, {
      before: oldMeetingRoom?.toObject(),
      after: meetingRoom.toObject(),
      fields: ['name', 'building', 'capacity', 'amenities', 'pricing', 'status']
    }, {
      roomName: meetingRoom.name,
      updatedFields: ['name', 'building', 'capacity', 'amenities', 'pricing', 'status']
    });

    return res.json({
      success: true,
      message: 'Meeting room updated successfully',
      data: meetingRoom
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update room
export const updateRoom = async (req, res) => {
  try {
    const updateData = { ...req.body };
    
    // Handle uploaded images with ImageKit
    if (req.files && req.files.length > 0) {
      const imageUploadPromises = req.files.map(async (file) => {
        try {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `meeting-room-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`,
            folder: '/meeting-rooms'
          });
          return result.url;
        } catch (uploadError) {
          console.error('ImageKit upload error:', uploadError);
          throw uploadError;
        }
      });
      
      const newImageUrls = await Promise.all(imageUploadPromises);
      
      // Get existing room to preserve existing images if needed
      const existingRoom = await MeetingRoom.findById(req.params.id);
      if (existingRoom) {
        // Handle existing images from request body
        const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];
        updateData.images = [...existingImages, ...newImageUrls];
      } else {
        updateData.images = newImageUrls;
      }
    }
    
    // If no new files uploaded, still honor existingImages (including empty array to clear all)
    if ((!req.files || req.files.length === 0) && typeof req.body.existingImages !== 'undefined') {
      try {
        const existingImagesOnly = JSON.parse(req.body.existingImages);
        updateData.images = Array.isArray(existingImagesOnly) ? existingImagesOnly : [];
      } catch (e) {
        // If parsing fails, ignore and let it proceed without changing images
      }
    }
    
    // Validate matrix devices if provided
    if (updateData.matrixDeviceIds !== undefined) {
      const ids = Array.isArray(updateData.matrixDeviceIds) ? updateData.matrixDeviceIds : [];
      const existing = await MeetingRoom.findById(req.params.id).select('building');
      if (!existing) return res.status(404).json({ success: false, message: 'Room not found' });
      const buildingId = updateData.building || existing.building;
      if (ids.length > 0) {
        const devices = await MatrixDevice.find({ _id: { $in: ids } }).select('_id buildingId status').lean();
        const foundIds = new Set(devices.map(d => String(d._id)));
        const missing = ids.map(String).filter(x => !foundIds.has(x));
        if (missing.length) return res.status(400).json({ success: false, message: `Unknown matrix devices: ${missing.join(', ')}` });
        const invalid = devices.filter(d => String(d.buildingId) !== String(buildingId));
        if (invalid.length) return res.status(400).json({ success: false, message: 'Matrix devices must belong to the same building as the meeting room' });
        const inactive = devices.filter(d => d.status !== 'active');
        if (inactive.length) return res.status(400).json({ success: false, message: 'Matrix devices must be active' });
      }
      updateData.matrixDevices = ids;
      delete updateData.matrixDeviceIds;
    }

    const room = await MeetingRoom.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    
    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      imagesCount: room.images?.length || 0
    });
    
    return res.json({ success: true, data: room });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Update availability only
export const updateAvailability = async (req, res) => {
  try {
    const { availability, blackoutDates, availableTimeSlots, isBookingClosed } = req.body || {};
    const room = await MeetingRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (availability) room.availability = { ...room.availability, ...availability };
    if (Array.isArray(blackoutDates)) room.blackoutDates = blackoutDates;
    if (Array.isArray(availableTimeSlots)) room.availableTimeSlots = availableTimeSlots;
    if (typeof isBookingClosed === 'boolean') room.isBookingClosed = isBookingClosed;

    await room.save();
    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      updatedFields: ['availability', 'blackoutDates', 'availableTimeSlots', 'isBookingClosed']
    });
    return res.json({ success: true, data: room });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Get available time slots for a specific date
export const getAvailableSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ success: false, message: "Date is required" });
    }

    const room = await MeetingRoom.findById(id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (room.isBookingClosed) {
      return res.json({ 
        success: true, 
        data: [], 
        message: "Booking is currently closed for this room" 
      });
    }

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Filter reserved slots for the specific date
    const reservedForDate = room.reservedSlots.filter(slot => {
      const slotDate = new Date(slot.date);
      slotDate.setHours(0, 0, 0, 0);
      return slotDate.getTime() === targetDate.getTime();
    });

    // Get reserved time ranges
    const reservedTimes = reservedForDate.map(slot => ({
      startTime: slot.startTime,
      endTime: slot.endTime
    }));

    // Filter available slots by removing reserved ones
    const availableSlots = room.availableTimeSlots.filter(slot => {
      return !reservedTimes.some(reserved => 
        reserved.startTime === slot.startTime && reserved.endTime === slot.endTime
      );
    });

    return res.json({ 
      success: true, 
      data: availableSlots,
      reservedSlots: reservedTimes,
      totalSlots: room.availableTimeSlots.length,
      availableCount: availableSlots.length
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Add reserved slot
export const addReservedSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, bookingId } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ 
        success: false, 
        message: "Date, startTime, and endTime are required" 
      });
    }

    const room = await MeetingRoom.findById(id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (room.isBookingClosed) {
      return res.status(400).json({ 
        success: false, 
        message: "Booking is currently closed for this room" 
      });
    }

    // Check if slot is already reserved
    // Parse date in IST and store at midnight IST
    const targetDate = new Date(date + 'T00:00:00+05:30');

    const isAlreadyReserved = room.reservedSlots.some(slot => {
      const slotDate = new Date(slot.date);
      const slotDateIST = new Date(slotDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      slotDateIST.setHours(0, 0, 0, 0);
      const targetDateIST = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      targetDateIST.setHours(0, 0, 0, 0);
      return slotDateIST.getTime() === targetDateIST.getTime() && 
             slot.startTime === startTime && 
             slot.endTime === endTime;
    });

    if (isAlreadyReserved) {
      return res.status(400).json({ 
        success: false, 
        message: "This time slot is already reserved" 
      });
    }

    room.reservedSlots.push({ date: targetDate, startTime, endTime, bookingId });
    await room.save();

    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      action: 'Added reserved slot',
      slotDetails: { date, startTime, endTime }
    });

    return res.json({ 
      success: true, 
      message: "Time slot reserved successfully",
      data: room 
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Remove reserved slot
export const removeReservedSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ 
        success: false, 
        message: "Date, startTime, and endTime are required" 
      });
    }

    const room = await MeetingRoom.findById(id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    // Parse date in IST
    const targetDate = new Date(date + 'T00:00:00+05:30');
    const targetDateIST = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    targetDateIST.setHours(0, 0, 0, 0);

    const initialLength = room.reservedSlots.length;
    room.reservedSlots = room.reservedSlots.filter(slot => {
      const slotDate = new Date(slot.date);
      const slotDateIST = new Date(slotDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      slotDateIST.setHours(0, 0, 0, 0);
      return !(slotDateIST.getTime() === targetDateIST.getTime() && 
               slot.startTime === startTime && 
               slot.endTime === endTime);
    });

    if (room.reservedSlots.length === initialLength) {
      return res.status(404).json({ 
        success: false, 
        message: "Reserved slot not found" 
      });
    }

    await room.save();

    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      action: 'Removed reserved slot',
      slotDetails: { date, startTime, endTime }
    });

    return res.json({ 
      success: true, 
      message: "Reserved slot removed successfully",
      data: room 
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Toggle booking status
export const toggleBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const room = await MeetingRoom.findById(id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    room.isBookingClosed = !room.isBookingClosed;
    await room.save();

    await logCRUDActivity(req, 'UPDATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      action: 'Toggled booking status',
      isBookingClosed: room.isBookingClosed
    });

    return res.json({ 
      success: true, 
      message: `Booking ${room.isBookingClosed ? 'closed' : 'opened'} successfully`,
      data: room 
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get available meeting rooms by date and time range
export const getAvailableRoomsByTime = async (req, res) => {
  try {
    const { date, startTime, endTime, building, minCapacity } = req.query;

    // Validate required parameters (date is required; time range optional)
    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required"
      });
    }

    const timesProvided = Boolean(startTime && endTime);

    // Parse the date (supports YYYY-MM-DD or DD-MM-YYYY) in IST and create base day start
    const parseDateToIST = (dateStr) => {
      let y, m, d;
      const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
      const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/;
      if (ddmmyyyy.test(dateStr)) {
        const [, dd, mm, yyyy] = dateStr.match(ddmmyyyy);
        y = parseInt(yyyy, 10);
        m = parseInt(mm, 10) - 1;
        d = parseInt(dd, 10);
      } else if (yyyymmdd.test(dateStr)) {
        const [, yyyy, mm, dd] = dateStr.match(yyyymmdd);
        y = parseInt(yyyy, 10);
        m = parseInt(mm, 10) - 1;
        d = parseInt(dd, 10);
      } else {
        // Fallback to native Date parsing (may expect YYYY-MM-DD)
        const fallback = new Date(dateStr + 'T00:00:00+05:30');
        const fallbackIST = new Date(fallback.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        fallbackIST.setHours(0, 0, 0, 0);
        return fallbackIST;
      }
      const base = new Date(Date.UTC(y, m, d, 0, 0, 0));
      // Shift to IST midnight by creating a date string localized to IST
      const ist = new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      ist.setHours(0, 0, 0, 0);
      return ist;
    };

    const targetDateIST = parseDateToIST(String(date));
    const dayStart = new Date(targetDateIST);
    const dayEnd = new Date(targetDateIST);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Canonical YYYY-MM-DD for the requested date (based on input string)
    const requestedYMD = (() => {
      const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
      const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/;
      if (ddmmyyyy.test(String(date))) {
        const [, dd, mm, yyyy] = String(date).match(ddmmyyyy);
        return `${yyyy}-${mm}-${dd}`;
      }
      if (yyyymmdd.test(String(date))) {
        const [, yyyy, mm, dd] = String(date).match(yyyymmdd);
        return `${yyyy}-${mm}-${dd}`;
      }
      try {
        return new Date(String(date)).toISOString().slice(0, 10);
      } catch (e) {
        return undefined;
      }
    })();

    // Helper to decide if a slot.date belongs to the requested date
    const isSameRequestedDate = (slotDate) => {
      try {
        const isoYMD = new Date(slotDate).toISOString().slice(0, 10);
        if (requestedYMD && isoYMD === requestedYMD) return true;
      } catch (e) {}
      // Fallback to IST day match
      const slotDateIST = new Date(new Date(slotDate).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      slotDateIST.setHours(0, 0, 0, 0);
      return slotDateIST.getTime() === targetDateIST.getTime();
    };

    // If times provided, build Date objects in IST
    let requestedStart = null;
    let requestedEnd = null;
    if (timesProvided) {
      const [startHour, startMinute] = startTime.split(':').map(Number);
      const [endHour, endMinute] = endTime.split(':').map(Number);

      requestedStart = new Date(targetDateIST);
      requestedStart.setHours(startHour, startMinute, 0, 0);

      requestedEnd = new Date(targetDateIST);
      requestedEnd.setHours(endHour, endMinute, 0, 0);

      // Validate time range
      if (requestedStart >= requestedEnd) {
        return res.status(400).json({
          success: false,
          message: "End time must be after start time"
        });
      }
    }

    // Build filter for meeting rooms
    const roomFilter = { status: 'active' };
    if (building) roomFilter.building = building;
    if (minCapacity) roomFilter.capacity = { $gte: Number(minCapacity) };

    // Get all active meeting rooms matching the filter
    const allRooms = await MeetingRoom.find(roomFilter)
      .populate('building', 'name address city')
      .sort({ name: 1 });

    // Helper: check if time ranges overlap
    const timeRangesOverlap = (start1, end1, start2, end2) => start1 < end2 && end1 > start2;

    // Helper: convert 12h time strings to 24h (kept from existing impl below)
    const convertTo24Hour = (timeStr) => {
      if (!timeStr) return timeStr;
      const isPM = timeStr.includes('PM');
      const isAM = timeStr.includes('AM');
      if (!isPM && !isAM) return timeStr;
      const cleanTime = timeStr.replace(/\s*(AM|PM)\s*/i, '').trim();
      const [hourStr, minuteStr] = cleanTime.split(':');
      let hour = parseInt(hourStr);
      const minute = minuteStr || '00';
      if (isPM && hour !== 12) hour += 12;
      if (isAM && hour === 12) hour = 0;
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    };

    // Branch 1: Daily slots mode (only date provided)
    if (!timesProvided) {
      // Fetch all bookings that overlap this date
      const bookingsForDay = await MeetingBooking.find({
        start: { $lt: dayEnd },
        end: { $gt: dayStart },
        status: { $in: ['booked', 'payment_pending'] }
      }).select('room start end');

      // Group bookings by room
      const bookingsByRoom = new Map();
      for (const b of bookingsForDay) {
        const key = String(b.room);
        if (!bookingsByRoom.has(key)) bookingsByRoom.set(key, []);
        bookingsByRoom.get(key).push(b);
      }

      const roomsWithSlots = allRooms.map(room => {
        const roomObj = room.toObject();

        // Blackout or closed => no available slots
        const isBlackout = room.blackoutDates?.some(blackoutDate => {
          const blackout = new Date(blackoutDate);
          const blackoutIST = new Date(blackout.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
          blackoutIST.setHours(0, 0, 0, 0);
          return blackoutIST.getTime() === targetDateIST.getTime();
        });
        const isClosed = !!room.isBookingClosed;

        // Filter reserved slots for this date only
        const reservedSlotsForDate = (room.reservedSlots || []).filter(slot => isSameRequestedDate(slot.date)).map(slot => ({
          ...slot,
          startTime: convertTo24Hour(slot.startTime),
          endTime: convertTo24Hour(slot.endTime)
        }));

        // Start with room's defined available slots (normalize to 24h)
        let availableSlots = (room.availableTimeSlots || []).map(s => ({
          startTime: convertTo24Hour(s.startTime),
          endTime: convertTo24Hour(s.endTime)
        }));

        // Remove slots that are in reservedSlots for this date
        const parseSlotRange = (slot) => {
          const [sh, sm] = slot.startTime.split(':').map(Number);
          const [eh, em] = slot.endTime.split(':').map(Number);
          const s = new Date(targetDateIST); s.setHours(sh, sm, 0, 0);
          const e = new Date(targetDateIST); e.setHours(eh, em, 0, 0);
          return { s, e };
        };

        const reservedDateRanges = reservedSlotsForDate.map(parseSlotRange);

        availableSlots = availableSlots.filter(slot => {
          const { s, e } = parseSlotRange(slot);
          // Remove if overlaps any reserved slot
          if (reservedDateRanges.some(r => timeRangesOverlap(s, e, r.s, r.e))) return false;

          // Remove if overlaps any booking for this room on this date
          const roomBookings = bookingsByRoom.get(String(room._id)) || [];
          if (roomBookings.some(b => timeRangesOverlap(s, e, b.start, b.end))) return false;

          return true;
        });

        // If blackout/closed, zero out available slots
        if (isBlackout || isClosed) {
          availableSlots = [];
        }

        // Include booking intervals for the day for visibility
        const bookedIntervals = (bookingsByRoom.get(String(room._id)) || []).map(b => ({
          start: b.start,
          end: b.end,
          bookingId: b._id
        }));

        return {
          ...roomObj,
          reservedSlots: reservedSlotsForDate, // only for requested date
          availableTimeSlots: availableSlots,  // only for requested date after removals
          bookedIntervals,
          isBlackout,
          isBookingClosed: isClosed
        };
      });

      const roomsWithAvailability = roomsWithSlots.filter(r => (r.availableTimeSlots || []).length > 0);

      return res.json({
        success: true,
        mode: 'daily-slots',
        date: targetDateIST,
        rooms: roomsWithAvailability,
        count: roomsWithAvailability.length,
        summary: {
          totalRooms: allRooms.length,
          roomsWithAvailability: roomsWithAvailability.length,
          blackoutCount: roomsWithSlots.filter(r => r.isBlackout).length,
          closedCount: roomsWithSlots.filter(r => r.isBookingClosed).length
        }
      });
    }

    // Branch 2: Original time-range availability mode
    // Find all bookings that overlap with the requested time range
    const overlappingBookings = await MeetingBooking.find({
      start: { $lt: requestedEnd },
      end: { $gt: requestedStart },
      status: { $in: ['booked', 'payment_pending'] }
    }).select('room start end');

    // Create a set of booked room IDs
    const bookedRoomIds = new Set(
      overlappingBookings.map(booking => booking.room.toString())
    );

    // Filter available rooms
    const availableRooms = allRooms.filter(room => {
      // Check if room is booking closed
      if (room.isBookingClosed) return false;

      // Check if date is in blackout dates
      const isBlackout = room.blackoutDates?.some(blackoutDate => {
        const blackout = new Date(blackoutDate);
        const blackoutIST = new Date(blackout.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        blackoutIST.setHours(0, 0, 0, 0);
        return blackoutIST.getTime() === targetDateIST.getTime();
      });
      if (isBlackout) return false;

      // Check if room is already booked during this time
      if (bookedRoomIds.has(room._id.toString())) return false;

      // Check if the requested time overlaps with any reserved slots for this date
      const hasReservedSlotConflict = room.reservedSlots?.some(slot => {
        // Only consider reserved slots that belong to the requested date (handle UTC/IST storage)
        if (!isSameRequestedDate(slot.date)) return false;

        // Parse slot times in IST (handle both 12-hour and 24-hour formats)
        const parseTime = (timeStr) => {
          const isPM = timeStr.includes('PM');
          const isAM = timeStr.includes('AM');
          const cleanTime = timeStr.replace(/\s*(AM|PM)\s*/i, '').trim();
          const [hourStr, minuteStr] = cleanTime.split(':');
          let hour = parseInt(hourStr);
          const minute = parseInt(minuteStr);
          if (isPM && hour !== 12) hour += 12;
          if (isAM && hour === 12) hour = 0;
          return { hour, minute };
        };

        const slotStartTime = parseTime(slot.startTime);
        const slotEndTime = parseTime(slot.endTime);

        const slotStart = new Date(targetDateIST);
        slotStart.setHours(slotStartTime.hour, slotStartTime.minute, 0, 0);

        const slotEnd = new Date(targetDateIST);
        slotEnd.setHours(slotEndTime.hour, slotEndTime.minute, 0, 0);

        // Check if requested time overlaps with this reserved slot
        return timeRangesOverlap(requestedStart, requestedEnd, slotStart, slotEnd);
      });

      if (hasReservedSlotConflict) return false;

      return true;
    });

    // Get booked rooms with booking details
    const bookedRooms = allRooms
      .filter(room => bookedRoomIds.has(room._id.toString()))
      .map(room => {
        const bookings = overlappingBookings
          .filter(b => b.room.toString() === room._id.toString())
          .map(b => ({
            start: b.start,
            end: b.end,
            bookingId: b._id
          }));
        
        return {
          ...room.toObject(),
          conflictingBookings: bookings
        };
      });

    // Convert reserved and available slot times to 24-hour format for available rooms
    const availableRoomsFormatted = availableRooms.map(room => {
      const roomObj = room.toObject();
      if (roomObj.reservedSlots && roomObj.reservedSlots.length > 0) {
        roomObj.reservedSlots = roomObj.reservedSlots
          .filter(slot => isSameRequestedDate(slot.date))
          .map(slot => ({
            ...slot,
            startTime: convertTo24Hour(slot.startTime),
            endTime: convertTo24Hour(slot.endTime)
          }));
      }
      if (roomObj.availableTimeSlots && roomObj.availableTimeSlots.length > 0) {
        // Normalize and then remove slots that match reserved ones for this date
        const normalized = roomObj.availableTimeSlots.map(slot => ({
          startTime: convertTo24Hour(slot.startTime),
          endTime: convertTo24Hour(slot.endTime)
        }));
        if (roomObj.reservedSlots && roomObj.reservedSlots.length > 0) {
          const reservedPairs = new Set(
            roomObj.reservedSlots.map(s => `${s.startTime}-${s.endTime}`)
          );
          roomObj.availableTimeSlots = normalized.filter(s => !reservedPairs.has(`${s.startTime}-${s.endTime}`));
        } else {
          roomObj.availableTimeSlots = normalized;
        }
      }
      return roomObj;
    });

    // Convert reserved slot times to 24-hour format for booked rooms and filter only requested date
    const bookedRoomsFormatted = bookedRooms.map(room => {
      if (room.reservedSlots && room.reservedSlots.length > 0) {
        room.reservedSlots = room.reservedSlots
          .filter(slot => isSameRequestedDate(slot.date))
          .map(slot => ({
            ...slot,
            startTime: convertTo24Hour(slot.startTime),
            endTime: convertTo24Hour(slot.endTime)
          }));
      }
      if (room.availableTimeSlots && room.availableTimeSlots.length > 0) {
        room.availableTimeSlots = room.availableTimeSlots.map(slot => ({
          startTime: convertTo24Hour(slot.startTime),
          endTime: convertTo24Hour(slot.endTime)
        }));
      }
      return room;
    });

    return res.json({
      success: true,
      mode: 'time-range',
      available: {
        date: targetDateIST,
        startTime: convertTo24Hour(startTime),
        endTime: convertTo24Hour(endTime),
        start: requestedStart,
        end: requestedEnd,
        rooms: availableRoomsFormatted,
        count: availableRoomsFormatted.length
      },
      booked: bookedRoomsFormatted,
      summary: {
        totalRooms: allRooms.length,
        availableCount: availableRooms.length,
        bookedCount: bookedRooms.length,
        closedCount: allRooms.filter(r => r.isBookingClosed).length
      }
    });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};


// Delete (hard delete)
export const deleteRoom = async (req, res) => {
  try {
    const meetingRoom = await MeetingRoom.findById(req.params.id);
    if (!meetingRoom) return res.status(404).json({ success: false, message: "Room not found" });
    
    await MeetingRoom.deleteOne({ _id: req.params.id });
    await logCRUDActivity(req, 'DELETE', 'MeetingRoom', meetingRoom._id, null, {
      roomName: meetingRoom.name
    });
    return res.json({ success: true, message: "Meeting room deleted" });
  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({ success: false, message: error.message });
  }
};