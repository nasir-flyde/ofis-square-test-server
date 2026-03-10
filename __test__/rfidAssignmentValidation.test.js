import { jest } from "@jest/globals";
import mongoose from "mongoose";

/* ================= MOCK DEPENDENCIES ================= */

// Mock RFIDCard model
jest.unstable_mockModule("../../models/rfidCardModel.js", () => ({
    default: {
        create: jest.fn(),
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        findOne: jest.fn()
    }
}));

// Mock Client model
jest.unstable_mockModule("../../models/clientModel.js", () => ({
    default: {
        findById: jest.fn(),
        findOne: jest.fn()
    }
}));

// Mock Member model
jest.unstable_mockModule("../../models/memberModel.js", () => ({
    default: {
        findById: jest.fn()
    }
}));

// Mock User model
jest.unstable_mockModule("../../models/userModel.js", () => ({
    default: {
        findOne: jest.fn(),
        create: jest.fn()
    }
}));

// Mock Role model
jest.unstable_mockModule("../../models/roleModel.js", () => ({
    default: {
        findOne: jest.fn(),
        create: jest.fn()
    }
}));

// Mock ProvisioningJob
jest.unstable_mockModule("../../models/provisioningJobModel.js", () => ({
    default: {
        create: jest.fn()
    }
}));

// Mock activity logger
jest.unstable_mockModule("../../utils/activityLogger.js", () => ({
    logCRUDActivity: jest.fn(),
    logErrorActivity: jest.fn()
}));


/* ================= IMPORT AFTER MOCK ================= */

const { default: RFIDCard } = await import("../../models/rfidCardModel.js");
const { default: Client } = await import("../../models/clientModel.js");
const { default: Member } = await import("../../models/memberModel.js");

const {
    createRFIDCard,
    assignClientToCard,
    assignMemberToCardByCompany
} = await import("../rfidCardController.js");


/* ================= HELPER ================= */

const mockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});


describe("RFID Assignment Validations – Uniqueness & Reassignment Rules", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    /* ================= RFID UNIQUENESS ================= */

    test("should reject duplicate cardUid", async () => {

        RFIDCard.create.mockRejectedValue({
            code: 11000,
            message: "Duplicate key error"
        });

        const req = {
            body: { cardUid: "ABC123" }
        };

        const res = mockRes();

        await createRFIDCard(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: false })
        );
    });

    /* ================= CLIENT ASSIGNMENT ================= */

    test("should reject assignment if card already assigned to client", async () => {

        RFIDCard.findById.mockResolvedValue({
            clientId: "existingClientId"
        });

        const req = {
            params: { id: "card1" },
            body: { clientId: "newClientId" },
            user: { role: { roleName: "admin" } }
        };

        const res = mockRes();

        await assignClientToCard(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    test("should return 404 if card not found", async () => {

        const validClientId = new mongoose.Types.ObjectId().toString();

        RFIDCard.findById.mockResolvedValue(null);
        Client.findById.mockResolvedValue({ _id: validClientId });

        const req = {
            params: { id: "card1" },
            body: { clientId: validClientId },
            user: { role: { roleName: "admin" } }
        };

        const res = mockRes();

        await assignClientToCard(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });




    test("should reject assignment for unauthorized role", async () => {

        const req = {
            params: { id: "card1" },
            body: { clientId: "client1" },
            user: { role: { roleName: "client" } }
        };

        const res = mockRes();

        await assignClientToCard(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
    });


    /* ================= MEMBER REASSIGNMENT ================= */

    test("should reject if card not linked to any client", async () => {

        RFIDCard.findById.mockResolvedValue({
            clientId: null
        });

        const req = {
            params: { id: "card1" },
            body: { memberId: "member1" },
            user: { _id: "user1", clientId: "client1" }
        };

        const res = mockRes();

        await assignMemberToCardByCompany(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });


    test("should reject if member belongs to different client", async () => {

        const mockCard = {
            clientId: "client1",
            companyUserId: "ownerUser"
        };

        RFIDCard.findById.mockResolvedValue(mockCard);

        Member.findById.mockResolvedValue({
            client: "client2"
        });

        const req = {
            params: { id: "card1" },
            body: { memberId: "member1" },
            user: { _id: "ownerUser", clientId: "client1" }
        };

        const res = mockRes();

        await assignMemberToCardByCompany(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });


    test("should reject if user is not authorized", async () => {

        const validMemberId = new mongoose.Types.ObjectId().toString();

        const mockCard = {
            _id: "card1",
            clientId: "client1",
            companyUserId: "ownerUser"
        };

        RFIDCard.findById.mockResolvedValue(mockCard);

        Member.findById.mockResolvedValue({
            _id: validMemberId,
            client: "client1"
        });

        const req = {
            params: { id: "card1" },
            body: { memberId: validMemberId },
            user: { _id: "randomUser", clientId: "differentClient" }
        };

        const res = mockRes();

        await assignMemberToCardByCompany(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
    });



    test("should allow valid member assignment", async () => {

        const validMemberId = new mongoose.Types.ObjectId().toString();

        const mockCard = {
            _id: "card1",
            clientId: "client1",
            companyUserId: "ownerUser",
            save: jest.fn(),
            toObject: jest.fn().mockReturnValue({})
        };

        RFIDCard.findById.mockResolvedValue(mockCard);

        Member.findById.mockResolvedValue({
            _id: validMemberId,
            client: "client1"
        });

        const req = {
            params: { id: "card1" },
            body: { memberId: validMemberId },
            user: { _id: "ownerUser", clientId: "client1" }
        };

        const res = mockRes();

        await assignMemberToCardByCompany(req, res);

        expect(mockCard.save).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
    });


});
