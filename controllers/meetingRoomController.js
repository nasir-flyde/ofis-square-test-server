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
