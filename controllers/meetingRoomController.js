import MeetingRoom from "../models/meetingRoomModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import path from "path";

// Create a meeting room
export const createRoom = async (req, res) => {
  try {
    const roomData = { ...req.body };
    
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
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const isAlreadyReserved = room.reservedSlots.some(slot => {
      const slotDate = new Date(slot.date);
      slotDate.setHours(0, 0, 0, 0);
      return slotDate.getTime() === targetDate.getTime() && 
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

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const initialLength = room.reservedSlots.length;
    room.reservedSlots = room.reservedSlots.filter(slot => {
      const slotDate = new Date(slot.date);
      slotDate.setHours(0, 0, 0, 0);
      return !(slotDate.getTime() === targetDate.getTime() && 
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
