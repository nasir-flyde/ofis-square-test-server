import MeetingRoom from "../models/meetingRoomModel.js";

// Create a meeting room
export const createRoom = async (req, res) => {
  try {
    const room = await MeetingRoom.create(req.body);
    return res.status(201).json({ success: true, data: room });
  } catch (error) {
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

    const rooms = await MeetingRoom.find(filter).populate('building', 'name address city').sort({ name: 1 });
    return res.json({ success: true, data: rooms });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get a room by ID
export const getRoomById = async (req, res) => {
  try {
    const room = await MeetingRoom.findById(req.params.id).populate('building', 'name address city');
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    return res.json({ success: true, data: room });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update room
export const updateRoom = async (req, res) => {
  try {
    const room = await MeetingRoom.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    return res.json({ success: true, data: room });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Update availability only
export const updateAvailability = async (req, res) => {
  try {
    const { availability, blackoutDates } = req.body || {};
    const room = await MeetingRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (availability) room.availability = { ...room.availability, ...availability };
    if (Array.isArray(blackoutDates)) room.blackoutDates = blackoutDates;

    await room.save();
    return res.json({ success: true, data: room });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

<<<<<<< Updated upstream
=======
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

    // Validate required parameters
    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "Date, startTime, and endTime are required"
      });
    }

    // Parse the date in IST and create start/end datetime objects
    const targetDate = new Date(date + 'T00:00:00+05:30');
    const targetDateIST = new Date(targetDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    targetDateIST.setHours(0, 0, 0, 0);

    // Create full datetime objects for the requested time range in IST
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    const requestedStart = new Date(targetDateIST);
    requestedStart.setHours(startHour, startMinute, 0, 0);

    const requestedEnd = new Date(targetDateIST);
    requestedEnd.setHours(endHour, endMinute, 0, 0);

    // Validate time range
    if (requestedStart >= requestedEnd) {
      return res.status(400).json({
        success: false,
        message: "End time must be after start time"
      });
    }

    // Build filter for meeting rooms
    const roomFilter = { status: 'active' };
    if (building) roomFilter.building = building;
    if (minCapacity) roomFilter.capacity = { $gte: Number(minCapacity) };

    // Get all active meeting rooms matching the filter
    const allRooms = await MeetingRoom.find(roomFilter)
      .populate('building', 'name address city')
      .sort({ name: 1 });

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

    // Helper function to check if time ranges overlap
    const timeRangesOverlap = (start1, end1, start2, end2) => {
      return start1 < end2 && end1 > start2;
    };

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
        const slotDate = new Date(slot.date);
        const slotDateIST = new Date(slotDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        slotDateIST.setHours(0, 0, 0, 0);
        
        // Only check slots for the same date
        if (slotDateIST.getTime() !== targetDateIST.getTime()) return false;

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

    // Helper function to convert 12-hour format to 24-hour format
    const convertTo24Hour = (timeStr) => {
      if (!timeStr) return timeStr;
      
      const isPM = timeStr.includes('PM');
      const isAM = timeStr.includes('AM');
      
      // If already in 24-hour format (no AM/PM), return as is
      if (!isPM && !isAM) return timeStr;
      
      const cleanTime = timeStr.replace(/\s*(AM|PM)\s*/i, '').trim();
      const [hourStr, minuteStr] = cleanTime.split(':');
      let hour = parseInt(hourStr);
      const minute = minuteStr || '00';
      
      if (isPM && hour !== 12) hour += 12;
      if (isAM && hour === 12) hour = 0;
      
      return `${hour.toString().padStart(2, '0')}:${minute.padStart(2, '0')}`;
    };

    // Convert reserved slot times to 24-hour format for available rooms
    const availableRoomsFormatted = availableRooms.map(room => {
      const roomObj = room.toObject();
      if (roomObj.reservedSlots && roomObj.reservedSlots.length > 0) {
        roomObj.reservedSlots = roomObj.reservedSlots.map(slot => ({
          ...slot,
          startTime: convertTo24Hour(slot.startTime),
          endTime: convertTo24Hour(slot.endTime)
        }));
      }
      if (roomObj.availableTimeSlots && roomObj.availableTimeSlots.length > 0) {
        roomObj.availableTimeSlots = roomObj.availableTimeSlots.map(slot => ({
          startTime: convertTo24Hour(slot.startTime),
          endTime: convertTo24Hour(slot.endTime)
        }));
      }
      return roomObj;
    });

    // Convert reserved slot times to 24-hour format for booked rooms
    const bookedRoomsFormatted = bookedRooms.map(room => {
      if (room.reservedSlots && room.reservedSlots.length > 0) {
        room.reservedSlots = room.reservedSlots.map(slot => ({
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

>>>>>>> Stashed changes
// Delete (hard delete)
export const deleteRoom = async (req, res) => {
  try {
    const room = await MeetingRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    
    await MeetingRoom.deleteOne({ _id: req.params.id });
    return res.json({ success: true, message: "Meeting room deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
