import mongoose from 'mongoose';
import { getAvailableRoomsByTime } from '../controllers/meetingRoomController.js';
import MeetingRoom from '../models/meetingRoomModel.js';
import Building from '../models/buildingModel.js';
import { buildingMap } from '../utils/cache.js';

// Mock models and dependencies
jest.mock('../models/meetingRoomModel.js');
jest.mock('../models/buildingModel.js');
jest.mock('../models/meetingBookingModel.js', () => ({
  find: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue([])
}));
jest.mock('../models/clientCreditWalletModel.js', () => ({
  findOne: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(null)
}));
jest.mock('../utils/activityLogger.js', () => ({
  logErrorActivity: jest.fn(),
  logCRUDActivity: jest.fn()
}));

// Mock the cache
jest.mock('../utils/cache.js', () => ({
  buildingMap: new Map(),
  amenityMap: new Map()
}));

describe('Meeting Room Cut-off and Time Validation', () => {
  let mockRes;
  let mockReq;
  const TZ_OFFSET_MINUTES = 330;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    buildingMap.clear();
  });

  const createMockRoom = (id, buildingId, cutoff = 0) => {
    const room = {
      _id: id,
      name: `Room ${id}`,
      building: buildingId,
      capacity: 10,
      status: 'active',
      availableTimeSlots: [
        { startTime: '09:00 AM', endTime: '10:00 AM' },
        { startTime: '10:00 AM', endTime: '11:00 AM' },
        { startTime: '11:00 AM', endTime: '12:00 PM' }
      ],
      availability: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      blackoutDates: [],
      isBookingClosed: false,
      pricing: { hourlyRate: 1000 }
    };

    buildingMap.set(buildingId.toString(), {
      _id: buildingId,
      name: 'Test Building',
      meetingBookingCutoffMinutes: cutoff
    });

    return room;
  };

  test('should skip room if requested start time is within cutoff (Range Mode)', async () => {
    const bId = new mongoose.Types.ObjectId();
    const rId = new mongoose.Types.ObjectId();
    const rooms = [createMockRoom(rId, bId, 30)]; // 30 min cutoff

    MeetingRoom.find.mockReturnThis();
    MeetingRoom.select.mockReturnThis();
    MeetingRoom.limit.mockReturnThis();
    MeetingRoom.lean.mockResolvedValue(rooms);

    // Current time: 10:45 AM IST
    const now = new Date();
    // We mock the Date globally to fix "today"
    const realDate = Date;
    global.Date = class extends realDate {
      constructor(date) {
        if (date) return new realDate(date);
        const d = new realDate();
        // Set fixed "now" for test: 10:45 AM IST today
        // IST = UTC + 5:30. So 10:45 AM IST = 05:15 AM UTC
        d.setUTCHours(5, 15, 0, 0); 
        return d;
      }
    };

    const todayIST = new realDate(new realDate().getTime() + (TZ_OFFSET_MINUTES * 60000)).toISOString().split('T')[0];

    mockReq = {
      query: {
        date: todayIST,
        startTime: '11:00 AM', // Starts in 15 mins (inside 30 min cutoff)
        endTime: '12:00 PM'
      }
    };

    await getAvailableRoomsByTime(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      count: 0,
      rooms: []
    }));

    global.Date = realDate;
  });

  test('should filter out past slots and cutoff slots (Daily Mode)', async () => {
    const bId = new mongoose.Types.ObjectId();
    const rId = new mongoose.Types.ObjectId();
    const rooms = [createMockRoom(rId, bId, 15)]; // 15 min cutoff

    MeetingRoom.find.mockReturnThis();
    MeetingRoom.select.mockReturnThis();
    MeetingRoom.limit.mockReturnThis();
    MeetingRoom.lean.mockResolvedValue(rooms);

    const realDate = Date;
    global.Date = class extends realDate {
      constructor(date) {
        if (date) return new realDate(date);
        const d = new realDate();
        // 10:45 AM IST = 05:15 AM UTC
        d.setUTCHours(5, 15, 0, 0); 
        return d;
      }
    };

    const todayIST = new realDate(new realDate().getTime() + (TZ_OFFSET_MINUTES * 60000)).toISOString().split('T')[0];

    mockReq = {
      query: {
        date: todayIST
      }
    };

    await getAvailableRoomsByTime(mockReq, mockRes);

    const response = mockRes.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.count).toBe(1);
    
    const availableSlots = response.rooms[0].availableTimeSlots;
    // 09:00 AM - 10:00 AM: Past (10:45 AM) -> filtered
    // 10:00 AM - 11:00 AM: Starts 10:00 AM (Past) -> filtered
    // 11:00 AM - 12:00 PM: Starts 11:00 AM (15 mins from now, cutoff is 15) -> Available (>= 10:45 + 15)
    
    expect(availableSlots.length).toBe(1);
    expect(availableSlots[0].startTime).toBe('11:00 AM');

    global.Date = realDate;
  });

  test('should return empty for past date', async () => {
    const bId = new mongoose.Types.ObjectId();
    const rId = new mongoose.Types.ObjectId();
    const rooms = [createMockRoom(rId, bId, 0)];

    MeetingRoom.find.mockReturnThis();
    MeetingRoom.select.mockReturnThis();
    MeetingRoom.limit.mockReturnThis();
    MeetingRoom.lean.mockResolvedValue(rooms);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayIST = new Date(yesterday.getTime() + (TZ_OFFSET_MINUTES * 60000)).toISOString().split('T')[0];

    mockReq = {
      query: {
        date: yesterdayIST
      }
    };

    await getAvailableRoomsByTime(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      count: 0,
      rooms: []
    }));
  });
});
