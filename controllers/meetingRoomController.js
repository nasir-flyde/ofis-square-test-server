import MeetingRoom from "../models/meetingRoomModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// Create a meeting room
export const createRoom = async (req, res) => {
  try {
    const room = await MeetingRoom.create(req.body);
    await logCRUDActivity(req, 'CREATE', 'MeetingRoom', room._id, null, {
      roomName: room.name,
      buildingId: room.building,
      capacity: room.capacity,
      hourlyRate: room.hourlyRate
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
      fields: ['name', 'building', 'capacity', 'amenities', 'hourlyRate', 'status']
    }, {
      roomName: meetingRoom.name,
      updatedFields: ['name', 'building', 'capacity', 'amenities', 'hourlyRate', 'status']
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
    const room = await MeetingRoom.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });
    return res.json({ success: true, data: room });
  } catch (error) {
    await logErrorActivity(req, error);
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
    await logErrorActivity(req, error);
    return res.status(400).json({ success: false, message: error.message });
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
