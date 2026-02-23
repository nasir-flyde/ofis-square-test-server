import MeetingRoom from "../models/meetingRoomModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Building from "../models/buildingModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import path from "path";
import MatrixDevice from "../models/matrixDeviceModel.js";

import { buildingMap, amenityMap } from "../utils/cache.js";
import csv from "csv-parser";
import { Readable } from "stream";

// Helper: format numeric floor as ordinal (1 -> 1st, 2 -> 2nd, 3 -> 3rd, 4 -> 4th, 11 -> 11th, etc.)
const formatFloorLabel = (floor) => {
  if (floor === undefined || floor === null || floor === "") return null;
  const num = Number(floor);
  if (!Number.isFinite(num)) return String(floor);
  const n = Math.trunc(num);
  const v = n % 100;
  if (v > 10 && v < 14) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

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
      hourlyRate: room.pricing?.hourlyRate,
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
      .populate('amenities', 'name icon iconUrl')
      .populate('matrixDevices', 'name device_id externalDeviceId')
      .sort({ createdAt: -1 });

    // Manual logging removed - handled by middleware for non-GET requests only

    return res.json({
      success: true,
      data: meetingRooms.map(r => {
        const obj = r.toObject();
        obj.floor = formatFloorLabel(obj.floor);
        return obj;
      }),
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
    const meetingRoom = await MeetingRoom.findById(id)
      .populate('building', 'name address city')
      .populate('amenities', 'name icon iconUrl')
      .populate('matrixDevices', 'name device_id externalDeviceId');

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

    const roomObj = meetingRoom.toObject();
    roomObj.floor = formatFloorLabel(roomObj.floor);

    return res.json({
      success: true,
      message: 'Meeting room updated successfully',
      data: roomObj
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
    const {
      date,
      startTime,
      endTime,
      building,
      minCapacity,
      capacity,
      floor,
      amenities
    } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: "Date is required" });
    }

    const timesProvided = Boolean(startTime && endTime);

    // ---- FAST DATE PARSE (NO toLocaleString COST) ----
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const dayStart = new Date(targetDate);
    const dayEnd = new Date(targetDate);
    dayEnd.setDate(dayEnd.getDate() + 1);

    let requestedStart, requestedEnd;

    if (timesProvided) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);

      requestedStart = new Date(targetDate);
      requestedStart.setHours(sh, sm, 0, 0);

      requestedEnd = new Date(targetDate);
      requestedEnd.setHours(eh, em, 0, 0);

      if (requestedStart >= requestedEnd) {
        return res.status(400).json({
          success: false,
          message: "End time must be after start time"
        });
      }
    }

    // ---- ROOM FILTER ----
    const roomFilter = { status: "active" };

    if (building) roomFilter.building = building;

    const cap = capacity || minCapacity;
    if (cap) roomFilter.capacity = { $gte: Number(cap) };

    if (floor) roomFilter.floor = floor;

    if (amenities) {
      const amenityIds = Array.isArray(amenities)
        ? amenities
        : amenities.split(",");
      roomFilter.amenities = { $all: amenityIds };
    }

    // ---- FETCH ROOMS (LEAN + PROJECTION) ----
    const rooms = await MeetingRoom.find(roomFilter)
      .select(
        "name capacity floor building amenities blackoutDates reservedSlots availableTimeSlots isBookingClosed"
      )
      .lean();

    if (!rooms.length) {
      return res.json({ success: true, rooms: [], count: 0 });
    }

    // ---- FETCH BOOKINGS (ONLY RELEVANT ONES) ----
    const bookingQuery = timesProvided
      ? {
        start: { $lt: requestedEnd },
        end: { $gt: requestedStart }
      }
      : {
        start: { $lt: dayEnd },
        end: { $gt: dayStart }
      };

    const bookings = await MeetingBooking.find({
      ...bookingQuery,
      status: { $in: ["booked", "payment_pending"] }
    })
      .select("room start end")
      .lean();

    // ---- GROUP BOOKINGS BY ROOM ----
    const bookingsByRoom = new Map();
    for (const b of bookings) {
      const key = String(b.room);
      if (!bookingsByRoom.has(key)) bookingsByRoom.set(key, []);
      bookingsByRoom.get(key).push(b);
    }

    const timeOverlap = (s1, e1, s2, e2) =>
      s1 < e2 && e1 > s2;

    const availableRooms = [];

    for (const room of rooms) {
      if (room.isBookingClosed) continue;

      const roomBookings = bookingsByRoom.get(String(room._id)) || [];

      if (timesProvided) {
        // TIME RANGE MODE

        if (roomBookings.length) continue;

        const hasReservedConflict = room.reservedSlots?.some(slot => {
          const slotStart = new Date(slot.start);
          const slotEnd = new Date(slot.end);
          return timeOverlap(requestedStart, requestedEnd, slotStart, slotEnd);
        });

        if (hasReservedConflict) continue;

        // Inject from cache
        room.building = buildingMap.get(room.building.toString());
        room.amenities = room.amenities.map(id => amenityMap.get(id.toString()));

        availableRooms.push(room);
      } else {
        // DAILY MODE

        let availableSlots = room.availableTimeSlots || [];

        if (roomBookings.length) {
          availableSlots = availableSlots.filter(slot => {
            const slotStart = new Date(slot.start);
            const slotEnd = new Date(slot.end);

            return !roomBookings.some(b =>
              timeOverlap(slotStart, slotEnd, b.start, b.end)
            );
          });
        }

        if (availableSlots.length > 0) {
          room.availableTimeSlots = availableSlots;

          // Inject from cache
          room.building = buildingMap.get(room.building.toString());
          room.amenities = room.amenities.map(id => amenityMap.get(id.toString()));

          availableRooms.push(room);
        }
      }
    }

    return res.json({
      success: true,
      date: targetDate,
      rooms: availableRooms,
      count: availableRooms.length
    });

  } catch (error) {
    await logErrorActivity(req, error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Export master reference data and sample rows for meeting rooms
export const exportMasterFile = async (_req, res) => {
  try {
    const CabinAmenity = (await import("../models/cabinAmenityModel.js")).default;
    const [buildings, amenities] = await Promise.all([
      Building.find().select('name').sort({ name: 1 }),
      CabinAmenity.find({ isActive: true }).select('name').sort({ name: 1 })
    ]);

    const statuses = ['active', 'inactive'];
    const masterData = {
      buildings: buildings.map(b => b.name),
      amenities: amenities.map(a => a.name),
      statuses
    };

    const sampleRows = [];
    if (buildings.length > 0) {
      const buildingName = buildings[0].name;
      const amenityNames = amenities.slice(0, 3).map(a => a.name);
      sampleRows.push({
        buildingName: buildingName,
        roomName: 'Conference A',
        capacity: '10',
        status: 'active',
        hourlyRate: '2500',
        floor: '1st Floor',
        amenity1: amenityNames[0] || 'WiFi',

        amenity2: amenityNames[1] || 'Projector',
        amenity3: amenityNames[2] || 'Whiteboard'
      });
      sampleRows.push({
        buildingName: buildingName,
        roomName: 'Board Room 1',
        capacity: '8',
        status: 'active',
        hourlyRate: '1800',
        floor: '2nd Floor',
        amenity1: amenityNames[0] || 'WiFi',

        amenity2: amenityNames[1] || 'Projector'
      });
    } else {
      sampleRows.push({
        buildingName: 'Main Building',
        roomName: 'Conference A',
        capacity: '10',
        status: 'active',
        hourlyRate: '2500',
        floor: 'Ground Floor',
        amenity1: 'WiFi',

        amenity2: 'Projector',
        amenity3: 'Whiteboard'
      });
    }

    return res.json({
      success: true,
      data: { masterData, sampleRows }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Download sample CSV for meeting rooms import
export const downloadSampleCSV = async (_req, res) => {
  try {
    const header = ['buildingName', 'roomName', 'capacity', 'floor', 'status', 'hourlyRate', 'amenities', 'deviceId', 'deviceType', 'images'];
    const sample1 = ['Main Building', 'Conference A', '10', '1st Floor', 'active', '2500', 'WiFi;Projector;Whiteboard', 'd_20001', '16', 'https://example.com/a.jpg;https://example.com/b.png'];
    const sample2 = ['Main Building', 'Board Room 1', '8', '2nd Floor', 'active', '1800', 'WiFi;Whiteboard', 'd_20002', '16', 'https://example.com/room1.jpg'];

    const csvText = [header.join(','), sample1.join(','), sample2.join(',')].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="meeting_rooms_import_sample.csv"');
    return res.send(csvText);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// CSV import for meeting rooms (memory upload via multer, field name: file)
export const importMeetingRoomsFromCSV = async (req, res) => {
  try {
    const file = req.file;
    const dryRun = String(req.query?.dryRun ?? req.body?.dryRun ?? 'false').toLowerCase() === 'true';
    if (!file) return res.status(400).json({ success: false, message: 'CSV file is required (field name: file)' });

    const rows = [];
    await new Promise((resolve, reject) => {
      try {
        const stream = Readable.from(file.buffer);
        stream
          .pipe(csv())
          .on('data', (data) => rows.push(data))
          .on('end', resolve)
          .on('error', reject);
      } catch (e) {
        reject(e);
      }
    });

    const CabinAmenity = (await import("../models/cabinAmenityModel.js")).default;
    const allAmenities = await CabinAmenity.find({ isActive: true }).select('name').lean();
    const amenityNameToId = new Map(allAmenities.map(a => [String(a.name).trim().toLowerCase(), String(a._id)]));

    const toNumber = (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : undefined;
    };
    const norm = (s) => (s === undefined || s === null ? '' : String(s).trim());
    const parseAmenities = (obj) => {
      const fromCombined = norm(obj.amenities);
      let list = [];
      if (fromCombined) list = fromCombined.split(/[;,]/).map(x => x.trim()).filter(Boolean);
      for (let i = 1; i <= 10; i++) {
        const key = `amenity${i}`;
        if (obj[key]) list.push(norm(obj[key]));
      }
      const ids = [];
      const missing = [];
      list.forEach(name => {
        const id = amenityNameToId.get(name.toLowerCase());
        if (id) ids.push(id);
        else missing.push(name);
      });
      return { ids, missing };
    };

    // Parse image URLs from multiple possible fields
    const parseImages = (obj) => {
      const urls = [];
      const addIfValid = (u) => {
        const url = norm(u);
        if (!url) return;
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            urls.push(parsed.toString());
          }
        } catch (_) {
          // ignore invalid URLs
        }
      };
      // combined column: images
      const combined = norm(obj.images);
      if (combined) {
        combined.split(/[;,]/).map(x => x.trim()).filter(Boolean).forEach(addIfValid);
      }
      // single common names
      ['imageUrl', 'imageURL', 'image'].forEach(k => addIfValid(obj[k]));
      // image1..image10
      for (let i = 1; i <= 10; i++) {
        addIfValid(obj[`image${i}`]);
      }
      // de-duplicate while preserving order
      const seen = new Set();
      const deduped = [];
      for (const u of urls) {
        if (!seen.has(u)) { seen.add(u); deduped.push(u); }
      }
      return deduped;
    };

    const perRow = [];
    let createdCount = 0;
    let validCount = 0;
    let invalidCount = 0;

    const buildings = await Building.find().select('name').lean();
    const buildingNameToId = new Map(buildings.map(b => [String(b.name).trim().toLowerCase(), String(b._id)]));

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const errors = [];
      const originalRow = { ...r };

      const buildingIdInput = norm(r.buildingId) || undefined;
      const buildingName = norm(r.buildingName);
      let buildingId = buildingIdInput;
      if (!buildingId) {
        if (!buildingName) errors.push('buildingName is required (or provide buildingId)');
        else {
          const mapped = buildingNameToId.get(buildingName.toLowerCase());
          if (!mapped) errors.push(`Unknown building name: ${buildingName}`);
          else buildingId = mapped;
        }
      }

      const roomName = norm(r.roomName) || norm(r.name);
      if (!roomName) errors.push('roomName is required');

      const capacity = toNumber(r.capacity);
      if (!capacity || capacity <= 0) errors.push('capacity must be a positive number');
      const status = (norm(r.status) || 'active').toLowerCase();
      if (!['active', 'inactive'].includes(status)) errors.push(`Invalid status: ${status}`);
      const hourlyRate = toNumber(r.hourlyRate || r.dailyRate);
      const floor = norm(r.floor);

      const { ids: amenityIds, missing: missingAmenityNames } = parseAmenities(r);
      if (missingAmenityNames.length) {
        errors.push(`Unknown amenities: ${missingAmenityNames.join(', ')}`);
      }

      // Parse image URLs
      const imageUrls = parseImages(r);

      // Optional Matrix Device fields from CSV (mirror cabin import behavior)
      const rawDeviceInput = norm(r.deviceId || r.device_id || r["device id"] || r["Device ID"] || r.device);
      const deviceTypeRaw = norm(r.deviceType || r["device type"] || r["Device Type"]);
      let deviceType = toNumber(deviceTypeRaw);
      let deviceIdRaw = rawDeviceInput || '';
      let deviceIdNormalized = undefined;
      let numericDevice = undefined;
      if (rawDeviceInput) {
        const stripped = rawDeviceInput.startsWith('d_') ? rawDeviceInput.slice(2) : rawDeviceInput;
        deviceIdNormalized = rawDeviceInput.startsWith('d_') ? rawDeviceInput : `d_${stripped}`;
        const n = toNumber(stripped);
        if (n !== undefined) numericDevice = n;
        if (deviceType === undefined) deviceType = 16;
        const allowedTypes = new Set([1, 16, 17]);
        if (!allowedTypes.has(deviceType)) {
          errors.push(`Invalid deviceType: ${deviceType}. Allowed: 1, 16, 17`);
        }
      }

      if (!errors.length) {
        // Duplicate check within building by name
        const dup = await MeetingRoom.findOne({ building: buildingId, name: roomName }).lean();
        if (dup) errors.push('Meeting room name already exists in this building');
      }

      if (errors.length) {
        invalidCount++;
        perRow.push({ index: idx + 1, success: false, errors, originalRow });
        continue;
      }

      validCount++;

      if (dryRun) {
        perRow.push({
          index: idx + 1,
          success: true,
          preview: { building: buildingId, name: roomName, capacity, floor, status, hourlyRate, amenities: amenityIds.length, deviceId: deviceIdNormalized || null, deviceType: deviceIdNormalized ? deviceType : undefined, imagesCount: imageUrls.length },

          originalRow
        });
        continue;
      }

      try {
        const room = await MeetingRoom.create({
          building: buildingId,
          name: roomName,
          capacity,
          status,
          floor: floor || undefined,
          pricing: hourlyRate !== undefined ? { hourlyRate } : undefined,

          amenities: amenityIds,
          images: imageUrls
        });

        // If device details provided, create or link MatrixDevice and attach to meeting room
        if (deviceIdNormalized) {
          let deviceDoc = await MatrixDevice.findOne({
            $or: [
              { device_id: deviceIdNormalized },
              ...(numericDevice !== undefined ? [{ device: numericDevice }] : []),
              ...(deviceIdRaw && deviceIdRaw !== deviceIdNormalized ? [{ device_id: deviceIdRaw }] : [])
            ]
          });

          if (!deviceDoc) {
            deviceDoc = await MatrixDevice.create({
              buildingId: buildingId,
              name: `Meeting Room ${roomName} Device`,
              vendor: 'MATRIX_COSEC',
              deviceType: deviceType ?? 16,
              direction: 'BIDIRECTIONAL',
              device_id: deviceIdNormalized,
              device: numericDevice,
              status: 'Active'
            });
          } else {
            let needSave = false;
            if (String(deviceDoc.buildingId || '') !== String(buildingId)) {
              deviceDoc.buildingId = buildingId;
              needSave = true;
            }
            if (deviceType !== undefined && deviceDoc.deviceType !== deviceType) {
              deviceDoc.deviceType = deviceType;
              needSave = true;
            }
            if (deviceDoc.device_id !== deviceIdNormalized) {
              deviceDoc.device_id = deviceIdNormalized;
              needSave = true;
            }
            if (numericDevice !== undefined && deviceDoc.device !== numericDevice) {
              deviceDoc.device = numericDevice;
              needSave = true;
            }
            if (needSave) await deviceDoc.save();
          }

          room.matrixDevices = Array.from(new Set([...(room.matrixDevices || []), deviceDoc._id]));
          await room.save();
        }

        await logCRUDActivity(req, 'CREATE', 'MeetingRoom', room._id, null, {
          imported: true,
          building: buildingId,
          name: roomName,
          capacity,
          status,
          hourlyRate: hourlyRate || null,
          floor: floor || null,

          amenities: amenityIds.length,
          matrixDevices: (room.matrixDevices || []).length
        });

        createdCount++;
        perRow.push({ index: idx + 1, success: true, id: room._id, originalRow });
      } catch (e) {
        invalidCount++;
        perRow.push({ index: idx + 1, success: false, errors: [e.message || 'Failed to create meeting room'], originalRow });
      }
    }

    const summary = {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      created: dryRun ? 0 : createdCount,
    };
    return res.json({
      success: true,
      dryRun,
      counts: { total: rows.length, valid: validCount, invalid: invalidCount, created: dryRun ? 0 : createdCount },
      summary,
      canImport: dryRun ? validCount > 0 : undefined,
      results: perRow,
    });
  } catch (error) {
    await logErrorActivity(req, 'CREATE', 'MeetingRoom', error.message);
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
export const exportRooms = async (req, res) => {
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
      .populate('amenities', 'name')
      .populate('matrixDevices', 'name')
      .sort({ createdAt: -1 });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'Room ID' },
        { id: 'buildingName', title: 'Building Name' },
        { id: 'name', title: 'Room Name' },
        { id: 'floor', title: 'Floor' },
        { id: 'capacity', title: 'Capacity' },
        { id: 'status', title: 'Status' },
        { id: 'isBookingClosed', title: 'Booking Closed' },

        { id: 'hourlyRate', title: 'Hourly Rate' },
        // If pricing schema has more fields, add them. Assuming simple pricing schema for now or JSON
        { id: 'pricingDetails', title: 'Pricing Details (JSON)' },

        { id: 'availOpenTime', title: 'Open Time' },
        { id: 'availCloseTime', title: 'Close Time' },
        { id: 'availDays', title: 'Available Days' },
        { id: 'minBooking', title: 'Min Booking (min)' },
        { id: 'maxBooking', title: 'Max Booking (min)' },

        { id: 'amenities', title: 'Amenities' },
        { id: 'matrixDevices', title: 'Matrix Devices' },
        { id: 'images', title: 'Image URLs' },
        { id: 'blackoutDates', title: 'Blackout Dates' },
        { id: 'communityDiscount', title: 'Community Max Discount (%)' },

        { id: 'createdAt', title: 'Created At' },
        { id: 'updatedAt', title: 'Updated At' }
      ]
    });

    const records = meetingRooms.map(room => {
      const avail = room.availability || {};
      const daysMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (avail.daysOfWeek || []).map(d => daysMap[d]).join(', ');

      return {
        id: room._id,
        buildingName: room.building?.name || '',
        name: room.name || '',
        floor: formatFloorLabel(room.floor) || '',
        capacity: room.capacity || '',
        status: room.status || '',
        isBookingClosed: room.isBookingClosed ? 'Yes' : 'No',

        hourlyRate: room.pricing?.hourlyRate || '',
        pricingDetails: JSON.stringify(room.pricing || {}),

        availOpenTime: avail.openTime || '',
        availCloseTime: avail.closeTime || '',
        availDays: days,
        minBooking: avail.minBookingMinutes || '',
        maxBooking: avail.maxBookingMinutes || '',

        amenities: (room.amenities || []).map(a => a.name).join('; '),
        matrixDevices: (room.matrixDevices || []).map(d => d.name).join('; '),
        images: (room.images || []).join('; '),
        blackoutDates: (room.blackoutDates || []).map(d => new Date(d).toISOString().split('T')[0]).join('; '),
        communityDiscount: room.communityMaxDiscountPercent || '',

        createdAt: room.createdAt ? new Date(room.createdAt).toISOString() : '',
        updatedAt: room.updatedAt ? new Date(room.updatedAt).toISOString() : ''
      };
    });

    const header = csvStringifier.getHeaderString();
    const csvRecords = csvStringifier.stringifyRecords(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="meeting_rooms_full_export.csv"');
    res.send(header + csvRecords);
  } catch (error) {
    console.error("exportRooms error:", error);
    res.status(500).send("Failed to export meeting rooms");
  }
};
