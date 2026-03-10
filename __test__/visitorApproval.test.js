import { jest } from "@jest/globals";

/* ================= MOCK DEPENDENCIES ================= */

// Mock Visitor model
jest.unstable_mockModule("../models/visitorModel.js", () => ({
    default: {
        findById: jest.fn(),
        findOne: jest.fn(),
        updateMany: jest.fn(),
        prototype: {
            save: jest.fn()
        }
    }
}));

// Mock jsonwebtoken
jest.unstable_mockModule("jsonwebtoken", () => ({
    default: {
        verify: jest.fn(),
        sign: jest.fn()
    },
    verify: jest.fn(),
    sign: jest.fn()
}));



// Mock notification helper (to avoid side effects)
jest.unstable_mockModule("../utils/notificationHelper.js", () => ({
    sendNotification: jest.fn()
}));

// Mock nodemailer
jest.unstable_mockModule("nodemailer", () => ({
    default: {
        createTransport: () => ({
            sendMail: jest.fn()
        })
    }
}));

// Mock QRCode
jest.unstable_mockModule("qrcode", () => ({
    default: {
        toBuffer: jest.fn()
    }
}));

/* ================= IMPORT AFTER MOCK ================= */

const { default: Visitor } = await import("../models/visitorModel.js");
const jwt = await import("jsonwebtoken");
const {
    approveCheckin,
    scanQRCode,
    markNoShows
} = await import("../controllers/visitorController.js");

/* ================= HELPER ================= */

const mockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});

describe("Visitor Approval Rules – Expiry & Access Duration", () => {

    let mockVisitor;
    let now;

    beforeEach(() => {
        jest.clearAllMocks();

        now = new Date("2026-02-17T10:00:00Z");
        jest.useFakeTimers();
        jest.setSystemTime(now);

        mockVisitor = {
            _id: "visitor123",
            status: "pending_checkin",
            expectedVisitDate: new Date(),
            save: jest.fn().mockResolvedValue(true),
            populate: jest.fn().mockResolvedValue(true),
            canCheckIn: jest.fn()
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /* ================= APPROVE CHECKIN ================= */

    test("should set qrExpiresAt 24 hours ahead on approval", async () => {

        Visitor.findById.mockReturnValue({
            populate: jest.fn().mockResolvedValue(mockVisitor)
        });

        const req = {
            params: { id: "visitor123" },
            user: { id: "admin1" },
            protocol: "http",
            get: () => "localhost:3000"
        };

        const res = mockRes();

        await approveCheckin(req, res);

        expect(mockVisitor.status).toBe("invited");
        expect(mockVisitor.approvedAt).toBeDefined();
        expect(mockVisitor.qrToken).toBeDefined();

        const expectedExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        expect(mockVisitor.qrExpiresAt.getTime()).toBe(expectedExpiry.getTime());

        expect(mockVisitor.save).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
    });

    /* ================= QR EXPIRY CHECK ================= */
    test("scanQRCode should reject expired or invalid token", async () => {

        Visitor.findOne.mockResolvedValue(null);

        const req = {
            body: { token: "invalidtoken" }
        };

        const res = mockRes();

        await scanQRCode(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                message: "Invalid or expired QR code"
            })
        );
    });

    test("scanQRCode should reject token if expired by qrExpiresAt", async () => {
        mockVisitor.qrExpiresAt = new Date(now.getTime() - 1000); // 1 second ago
        Visitor.findOne.mockResolvedValue(mockVisitor);

        const req = {
            body: { token: "expiredtoken" }
        };

        const res = mockRes();

        await scanQRCode(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                message: "QR code has expired"
            })
        );
    });


    /* ================= NO SHOW LOGIC ================= */

    test("markNoShows should update invited visitors to no_show", async () => {

        Visitor.updateMany.mockResolvedValue({ modifiedCount: 5 });

        const result = await markNoShows();

        expect(result).toBe(5);

        expect(Visitor.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "invited"
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: "no_show"
                })
            })
        );
    });

});
