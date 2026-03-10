_import { jest } from '@jest/globals';

/* ================= MOCK MODELS ================= */

jest.unstable_mockModule('../../models/meetingRoomModel.js', () => ({
  default: {
    findById: jest.fn(),
  },
}));

const { default: MeetingRoom } = await import('../../models/meetingRoomModel.js');
const { getAvailableSlots } = await import('../meetingRoomController.js');

/* ================= TEST SUITE ================= */

describe("getAvailableSlots Controller", () => {

  let req, res;

  beforeEach(() => {
    req = {
      params: { id: "room123" },
      query: { date: "2025-01-01" },
      headers: { 'user-agent': 'jest-test' } // ✅ prevent logger crash
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    jest.clearAllMocks();
  });

  test("returns 400 if date is missing", async () => {
    req.query = {};

    await getAvailableSlots(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("returns 404 if room not found", async () => {
    MeetingRoom.findById.mockResolvedValue(null);

    await getAvailableSlots(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("returns empty array if booking is closed", async () => {
    MeetingRoom.findById.mockResolvedValue({
      isBookingClosed: true,
      reservedSlots: [],
      availableTimeSlots: []
    });

    await getAvailableSlots(req, res);

    const response = res.json.mock.calls[0][0];

    expect(response.success).toBe(true);
    expect(response.data.length).toBe(0);
  });

  test("removes reserved slots from available slots", async () => {
    MeetingRoom.findById.mockResolvedValue({
      isBookingClosed: false,
      reservedSlots: [
        { date: "2025-01-01", startTime: "10:00", endTime: "11:00" }
      ],
      availableTimeSlots: [
        { startTime: "10:00", endTime: "11:00" },
        { startTime: "11:00", endTime: "12:00" }
      ]
    });

    await getAvailableSlots(req, res);

    const response = res.json.mock.calls[0][0];

    expect(response.data.length).toBe(1);
    expect(response.data[0].startTime).toBe("11:00");
  });

});
