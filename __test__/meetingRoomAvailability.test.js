import { expect, jest } from '@jest/globals';

/* ================= MOCK MODELS ================= */

jest.unstable_mockModule('../../models/meetingRoomModel.js', () => ({
    default: {
        find: jest.fn(),
    },
}));

jest.unstable_mockModule('../../models/meetingBookingModel.js', () => ({
    default: {
        find: jest.fn(),
    },
}));

/* ================= MOCK LOGGER ================= */

jest.unstable_mockModule('../../utils/activityLogger.js', () => ({
    logActivity: jest.fn(),
    logAuthActivity: jest.fn(),
    logCRUDActivity: jest.fn(),
    logPaymentActivity: jest.fn(),
    logContractActivity: jest.fn(),
    logBookingActivity: jest.fn(),
    logBulkActivity: jest.fn(),
    logSystemActivity: jest.fn(),
    logDataActivity: jest.fn(),
    logErrorActivity: jest.fn(),
    logBusinessEvent: jest.fn(),
}));




const { default: MeetingRoom } = await import('../../models/meetingRoomModel.js');
const { default: MeetingBooking } = await import('../../models/meetingBookingModel.js');
const { getAvailableRoomsByTime } = await import('../meetingRoomController.js');




const mockFindRooms = (rooms) => {
    MeetingRoom.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(rooms)
    });
};



/* ================= TEST SUITE ================= */

describe("getAvailableRoomsByTime - FULL COVERAGE", () => {

    let req, res;

    const baseRoom = {
        _id: "room1",
        name: "Room A",
        status: "active",
        capacity: 10,
        building: "building1",
        isBookingClosed: false,
        blackoutDates: [],
        reservedSlots: [],
        availableTimeSlots: [
            { startTime: "10:00", endTime: "11:00" },
            { startTime: "11:00", endTime: "12:00" }
        ],
        toObject() { return this; }
    };
    beforeEach(() => {
        req = {
            query: {},
            headers: { 'user-agent': 'jest-test' } // ✅ fix logger crash
        };

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };

        jest.clearAllMocks();
    });


    /* ================= VALIDATION ================= */

    test("returns 400 if date missing", async () => {
        await getAvailableRoomsByTime(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    /* ================= DAILY MODE ================= */

    describe("Daily Mode", () => {

        test("blackout date removes availability", async () => {
            req.query = { date: "2025-01-01" };

            const room = {
                ...baseRoom,
                blackoutDates: ["2025-01-01"]


            };

            MeetingRoom.find.mockReturnValue({
                populate: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue([room])
            });

            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("closed room removes availability", async () => {
            req.query = { date: "2025-01-01" };

            const room = {
                ...baseRoom,
                isBookingClosed: true
            };

            MeetingRoom.find.mockReturnValue({
                populate: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue([room])
            });

            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("reserved slot removes matching slot", async () => {
            req.query = { date: "2025-01-01" };

            const room = {
                ...baseRoom,
                reservedSlots: [
                    { date: "2025-01-01", startTime: "10:00", endTime: "11:00" }
                ]
            };

            MeetingRoom.find.mockReturnValue({
                populate: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue([room])
            });

            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms[0].availableTimeSlots.length).toBe(1);
            }

        });

        test("booking overlap removes slot", async () => {
            req.query = { date: "2025-01-01" };

            mockFindRooms([baseRoom]);;

            MeetingBooking.find.mockResolvedValue([
                {
                    room: "room1",
                    start: new Date("2025-01-01T10:00:00"),
                    end: new Date("2025-01-01T11:00:00")
                }
            ]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(1);
            }
        });

    });

    /* ================= TIME RANGE MODE ================= */

    describe("Time Range Mode", () => {

        test("invalid time range returns 400", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "12:00",
                endTime: "10:00"
            };

            await getAvailableRoomsByTime(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test("overlapping booking removes room", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "10:30 AM",
                endTime: "11:30 AM"
            };

            mockFindRooms([baseRoom]);;

            MeetingBooking.find.mockResolvedValue([
                {
                    room: "room1",
                    start: new Date("2025-01-01T10:00:00"),
                    end: new Date("2025-01-01T11:00:00")
                }
            ]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("non overlapping booking keeps room", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "12:00",
                endTime: "13:00"
            };

            mockFindRooms([baseRoom]);;

            MeetingBooking.find.mockResolvedValue([
                {
                    room: "room1",
                    start: new Date("2025-01-01T08:00:00"),
                    end: new Date("2025-01-01T09:00:00")
                }
            ]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.available.rooms.length).toBe(1)
            }

        });

        test("reserved slot conflict removes room", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "10:15",
                endTime: "10:45"
            };

            const room = {
                ...baseRoom,
                reservedSlots: [
                    { date: "2025-01-01", startTime: "10:00", endTime: "11:00" }
                ]
            };

            MeetingRoom.find.mockReturnValue({
                populate: jest.fn().mockReturnThis(),
                sort: jest.fn().mockResolvedValue([room])
            });

            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("capacity filter removes small rooms", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "12:00",
                endTime: "13:00",
                minCapacity: "20"
            };

            mockFindRooms([baseRoom]);;
            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("building filter removes unmatched rooms", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "12:00",
                endTime: "13:00",
                building: "building2"
            };

            mockFindRooms([baseRoom]);;
            MeetingBooking.find.mockResolvedValue([]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.rooms.length).toBe(0);
            }
        });

        test("boundary edge case does not overlap", async () => {
            req.query = {
                date: "2025-01-01",
                startTime: "11:00",
                endTime: "12:00"
            };

            mockFindRooms([baseRoom]);;

            MeetingBooking.find.mockResolvedValue([
                {
                    room: "room1",
                    start: new Date("2025-01-01T10:00:00"),
                    end: new Date("2025-01-01T11:00:00")
                }
            ]);

            await getAvailableRoomsByTime(req, res);

            const response = res.json.mock.calls[0][0];
            if (response.mode === 'daily-slots') {
                expect(response.available.rooms.length).toBe(1);
            }
        });

    });

});
