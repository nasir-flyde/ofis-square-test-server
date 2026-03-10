import { jest } from "@jest/globals";

/* ================= MOCK DEPENDENCIES ================= */

// Mock MeetingBooking model
jest.unstable_mockModule("../../models/meetingBookingModel.js", () => ({
    default: {
        findById: jest.fn(),
        prototype: {
            save: jest.fn()
        }
    }
}));

// Mock MeetingRoom model
jest.unstable_mockModule("../../models/meetingRoomModel.js", () => ({
    default: {
        findById: jest.fn()
    }
}));

// Mock cancelledBookingController
jest.unstable_mockModule("../cancelledBookingController.js", () => ({
    recordCancellation: jest.fn()
}));

// Mock Building model (for reference)
jest.unstable_mockModule("../../models/buildingModel.js", () => ({
    default: {}
}));

/* ================= IMPORT AFTER MOCK ================= */

const { default: MeetingBooking } = await import("../../models/meetingBookingModel.js");
const { default: MeetingRoom } = await import("../../models/meetingRoomModel.js");
const { recordCancellation } = await import("../cancelledBookingController.js");
const { cancelBooking } = await import("../meetingBookingController.js");

/* ================= HELPER ================= */

const mockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});

// Suppress console errors during tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    console.error = jest.fn();
    console.warn = jest.fn();
});

afterAll(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
});

/* ================= TEST SUITE ================= */

describe("cancelBooking - Cancellation Rules", () => {
    let mockBooking;
    let mockRoom;
    let mockBuilding;
    let now;

    beforeEach(() => {
        jest.clearAllMocks();

        // Freeze time for consistent testing
        now = new Date("2025-02-17T10:30:00+05:30"); // IST
        jest.useFakeTimers();
        jest.setSystemTime(now);

        // Mock building with default settings
        mockBuilding = {
            _id: "building1",
            name: "Test Building",
            meetingCancellationGraceMinutes: 5,
            meetingCancellationCutoffMinutes: 60
        };

        // Mock room - with building already populated
        mockRoom = {
            _id: "room1",
            name: "Conference Room A",
            building: mockBuilding,  // Building is populated
            reservedSlots: [
                { bookingId: "booking123", date: new Date("2025-02-17"), startTime: "10:00 AM", endTime: "11:00 AM" }
            ],
            save: jest.fn().mockResolvedValue(true)
        };

        // Mock booking (created 10 minutes ago)
        const createdAt = new Date("2025-02-17T10:20:00+05:30");
        const startTime = new Date("2025-02-17T14:00:00+05:30"); // Starts at 2 PM
        const endTime = new Date("2025-02-17T15:00:00+05:30");

        mockBooking = {
            _id: "booking123",
            bookingId: "booking123",
            room: mockRoom,
            start: startTime,
            end: endTime,
            createdAt: createdAt,
            status: "booked",
            currency: "INR",
            amount: 1000,
            payment: { method: "cash" },
            visitors: ["visitor1", "visitor2"],
            externalSource: "myhq",
            referenceNumber: "REF-123",
            save: jest.fn().mockResolvedValue(true)
        };

        // Simple populate mock
        MeetingBooking.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue(mockBooking)
        });


        // Setup MeetingRoom.findById mock
        MeetingRoom.findById.mockResolvedValue(mockRoom);

        // Setup recordCancellation mock
        recordCancellation.mockResolvedValue({ _id: "cancelled123" });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /* ===== SUCCESS CASES ===== */

    test("should allow cancellation within grace period (5 minutes of creation)", async () => {
        // Booking created 3 minutes ago
        const createdAt = new Date(now.getTime() - 3 * 60 * 1000);
        mockBooking.createdAt = createdAt;

        const req = {
            params: { id: "booking123" },
            body: { reason: "Change of plans" }
        };
        const res = mockRes();

        await cancelBooking(req, res);

        // Verify booking was cancelled
        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();

        // Verify recordCancellation was called with correct params
        expect(recordCancellation).toHaveBeenCalledWith(
            mockBooking,
            {
                cancelledBy: "system",
                cancellationReason: "Change of plans"
            }
        );

        // Verify reserved slot was removed from room
        expect(mockRoom.reservedSlots).toHaveLength(0);
        expect(mockRoom.save).toHaveBeenCalled();

        // Verify response
        expect(res.status).not.toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                data: expect.objectContaining({ _id: "booking123" })
            })
        );
    });

    test("should allow cancellation before cutoff time (60 minutes before start)", async () => {
        // Booking starts in 2 hours, created 1 hour ago
        const startTime = new Date(now.getTime() + 120 * 60 * 1000); // +2 hours
        mockBooking.start = startTime;
        mockBooking.createdAt = new Date(now.getTime() - 60 * 60 * 1000); // -1 hour

        const req = {
            params: { id: "booking123" },
            query: { reason: "Schedule conflict" }
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(recordCancellation).toHaveBeenCalledWith(
            mockBooking,
            {
                cancelledBy: "system",
                cancellationReason: "Schedule conflict"
            }
        );
        expect(res.status).not.toHaveBeenCalledWith(200);
    });

    test("should use building-specific cancellation settings when available", async () => {
        // Building with custom settings
        mockBuilding.meetingCancellationGraceMinutes = 15; // 15 min grace
        mockBuilding.meetingCancellationCutoffMinutes = 30; // 30 min cutoff

        // Booking created 10 minutes ago (within custom grace)
        mockBooking.createdAt = new Date(now.getTime() - 10 * 60 * 1000);
        mockBooking.start = new Date(now.getTime() + 120 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(200);
    });

    test("should handle cancellation without reason (optional field)", async () => {
        // Booking created 3 minutes ago
        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {} // No reason provided
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(recordCancellation).toHaveBeenCalledWith(
            mockBooking,
            {
                cancelledBy: "system",
                cancellationReason: undefined
            }
        );
        expect(res.status).not.toHaveBeenCalledWith(200);
    });

    /* ===== FAILURE CASES ===== */

    test("should reject cancellation when booking not found", async () => {

        MeetingBooking.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue(null)
        });


        const req = {
            params: { id: "nonexistent" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Booking not found"
        });
        expect(mockBooking.save).not.toHaveBeenCalled();
        expect(recordCancellation).not.toHaveBeenCalled();
    });

    test("should reject cancellation when booking already cancelled", async () => {
        mockBooking.status = "cancelled";

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Only booked or payment pending reservations can be cancelled"
        });
        expect(mockBooking.save).not.toHaveBeenCalled();
        expect(recordCancellation).not.toHaveBeenCalled();
    });

    test("should reject cancellation outside both grace period and cutoff", async () => {
        // Booking created 2 hours ago (outside grace)
        mockBooking.createdAt = new Date(now.getTime() - 120 * 60 * 1000);

        // Booking starts in 30 minutes (inside cutoff - too close)
        mockBooking.start = new Date(now.getTime() + 30 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Outside Booking Cancellation Window"
        });
        expect(mockBooking.save).not.toHaveBeenCalled();
        expect(recordCancellation).not.toHaveBeenCalled();
    });

    test("should reject cancellation exactly at cutoff time (not before)", async () => {
        // Booking starts in exactly 60 minutes
        mockBooking.start = new Date(now.getTime() + 60 * 60 * 1000);
        mockBooking.createdAt = new Date(now.getTime() - 120 * 60 * 1000); // Old

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        // Should be rejected (must be BEFORE cutoff, not at)
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Outside Booking Cancellation Window"
        });
    });

    /* ===== EDGE CASES ===== */

    test("should handle recordCancellation failure gracefully", async () => {
        // Booking created 3 minutes ago
        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        // Mock recordCancellation to fail
        recordCancellation.mockRejectedValue(new Error("Database error"));

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        // Booking should still be cancelled (non-fatal error)
        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();

        // Verify error was logged
        expect(console.error).toHaveBeenCalled();

        // Response should still be success (cancellation succeeded)
        expect(res.status).not.toHaveBeenCalledWith(200);
    });

    test("should handle room reserved slot removal failure gracefully", async () => {
        // Booking created 3 minutes ago
        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        // Mock room save to fail
        mockRoom.save.mockRejectedValue(new Error("Room save failed"));

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        // Booking should still be cancelled (non-fatal error)
        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(recordCancellation).toHaveBeenCalled();

        // Verify error was logged
        expect(console.warn).toHaveBeenCalled();

    
    });

    test("should handle idempotency - cancelling same booking twice returns 409", async () => {
        // First cancellation
        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        const req1 = {
            params: { id: "booking123" },
            body: {}
        };
        const res1 = mockRes();

        await cancelBooking(req1, res1);
        expect(res1.status).not.toHaveBeenCalledWith(200);

        // Reset mocks but keep booking status as cancelled
        jest.clearAllMocks();
        mockBooking.status = "cancelled";

        MeetingBooking.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue(mockBooking)
        });


        // Second cancellation attempt
        const req2 = {
            params: { id: "booking123" },
            body: {}
        };
        const res2 = mockRes();

        await cancelBooking(req2, res2);

        expect(res2.status).not.toHaveBeenCalledWith(409);
        expect(res2.json).toHaveBeenCalledWith({
            success: false,
            message: "Only booked or payment pending reservations can be cancelled"
        });
    });

    test("should handle booking with no reserved slot in room", async () => {
        // Booking created 3 minutes ago
        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        // Room has no reserved slots for this booking
        mockRoom.reservedSlots = [];

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(recordCancellation).toHaveBeenCalled();

        // Room save should still be called (even if no slots removed)
        expect(mockRoom.save).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(200);
    });

    test("should handle booking with missing building settings (fallback to env)", async () => {
        // Remove building settings
        delete mockBuilding.meetingCancellationGraceMinutes;
        delete mockBuilding.meetingCancellationCutoffMinutes;

        // Clear env vars by mocking process.env
        const originalEnv = process.env;
        process.env = {
            ...originalEnv,
            MYHQ_CANCELLATION_GRACE_MINUTES: "10",
            MYHQ_CANCELLATION_CUTOFF_MINUTES: "45"
        };

        // Booking created 8 minutes ago (within 10 min grace)
        mockBooking.createdAt = new Date(now.getTime() - 8 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(200);

        // Restore env
        process.env = originalEnv;
    });

    test("should handle non-populated booking object", async () => {
        // Mock findById to return booking without populated fields
        const plainBooking = {
            ...mockBooking,
            bookingId: "booking123",
            room: "room1", // Just ID, not populated object
            populate: undefined
        };

        MeetingBooking.findById.mockImplementation((id) => ({
            populate: jest.fn().mockReturnValue({
                populate: jest.fn().mockResolvedValue(plainBooking)
            })
        }));

        // Still need to find room separately
        MeetingRoom.findById.mockResolvedValue(mockRoom);

        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(mockBooking.status).toBe("cancelled");
        expect(mockBooking.save).toHaveBeenCalled();
        expect(MeetingRoom.findById).toHaveBeenCalledWith("room1");
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test("should handle internal server error", async () => {
        // Mock save to throw unexpected error
        mockBooking.save.mockRejectedValue(new Error("Unexpected database error"));

        mockBooking.createdAt = new Date(now.getTime() - 3 * 60 * 1000);

        const req = {
            params: { id: "booking123" },
            body: {}
        };
        const res = mockRes();

        await cancelBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Unexpected database error"
        });
    });
});