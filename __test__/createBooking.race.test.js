import { jest } from "@jest/globals";

/* ================= MOCK DEPENDENCIES ================= */

// Building model
jest.unstable_mockModule("../../models/buildingModel.js", () => ({
    default: {
        findById: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(null)
            })
        })
    }
}));

// Meeting Room
jest.unstable_mockModule("../../models/meetingRoomModel.js", () => ({
    default: {
        findById: jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "room1",
                name: "Room A",
                reservedSlots: [],
                status: "active",
                availability: {
                    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    openTime: "09:00",
                    closeTime: "19:00",
                    minBookingMinutes: 30,
                    maxBookingMinutes: 480
                },
                blackoutDates: [],
                building: "building1",
                pricing: {
                    hourlyRate: 500
                },
                communityMaxDiscountPercent: null,
                save: jest.fn().mockResolvedValue(true)
            })
        })
    }
}));

// At the top of your test file, after imports, add:
jest.mock("../meetingBookingController.js", () => {
    const originalModule = jest.requireActual("../meetingBookingController.js");
    return {
        ...originalModule,
        computeInvoiceTotals: jest.fn().mockImplementation((baseAmount, percent) => {
            // Return a predictable value for tests
            const discountAmount = 0;
            const sub_total = baseAmount;
            const tax_total = Math.round((sub_total * 18) / 100);
            const total = sub_total + tax_total;
            return Promise.resolve({
                discountAmount,
                sub_total,
                tax_total,
                total
            });
        })
    };
});

// Meeting Booking
jest.unstable_mockModule("../../models/meetingBookingModel.js", () => ({
    default: {
        findOne: jest.fn().mockReturnValue({
            lean: jest.fn()
        }),
        create: jest.fn()
    }
}));

// Client - FIXED: Add toObject method to both the returned object and the resolved value
jest.unstable_mockModule("../../models/clientModel.js", () => ({
    default: {
        findById: jest.fn().mockImplementation((id) => {
            const clientObj = {
                _id: id,
                email: "client@example.com",
                zohoBooksContactId: "zoho_contact_123",
                toObject: jest.fn().mockReturnValue({
                    _id: id,
                    email: "client@example.com",
                    zohoBooksContactId: "zoho_contact_123"
                })
            };

            return {
                select: jest.fn().mockResolvedValue(clientObj)
            };
        })
    }
}));

// Member - FIXED: Add proper populate chain
jest.unstable_mockModule("../../models/memberModel.js", () => ({
    default: {
        findById: jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "active",
                allowedUsingCredits: true,
                client: {
                    _id: "client1",
                    toObject: jest.fn().mockReturnValue({
                        _id: "client1",
                        email: "client@example.com",
                        zohoBooksContactId: "zoho_contact_123"
                    })
                },
                email: "member@example.com",
                firstName: "Test",
                companyName: "Test Co",
                toObject: jest.fn().mockReturnValue({
                    _id: "member1",
                    email: "member@example.com"
                })
            })
        })
    }
}));

// Notification helper - FIXED: Mock to avoid errors
jest.unstable_mockModule("../../utils/notificationHelper.js", () => ({
    sendNotification: jest.fn().mockResolvedValue({ success: true })
}));

// Wallet Service
jest.unstable_mockModule("../../services/walletService.js", () => ({
    default: {
        consumeCreditsWithOverdraft: jest.fn().mockResolvedValue({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        })
    }
}));

// Zoho - FIXED: Make all functions work properly
jest.unstable_mockModule("../../utils/zohoBooks.js", () => ({
    createZohoInvoiceFromLocal: jest.fn().mockResolvedValue({
        invoice: {
            invoice_id: "zoho_invoice_123",
            invoice_number: "INV-001"
        }
    }),
    recordZohoPayment: jest.fn().mockResolvedValue({ success: true }),
    fetchZohoInvoicePdfBinary: jest.fn().mockResolvedValue({
        buffer: Buffer.from("test pdf content")
    })
}));

// Invoice model - FIXED: Make it a proper constructor with all methods
jest.unstable_mockModule("../../models/invoiceModel.js", () => ({
    default: jest.fn().mockImplementation((data) => {
        const invoice = {
            ...data,
            _id: "invoice123",
            invoice_number: "MR-123456",
            zoho_invoice_id: null,
            zoho_invoice_number: null,
            client: data.client,
            total: data.total || 1000,
            status: data.status || "sent",
            save: jest.fn().mockImplementation(function () {
                // Simulate saving and setting Zoho IDs
                this.zoho_invoice_id = "zoho_invoice_123";
                this.zoho_invoice_number = "INV-001";
                return Promise.resolve(this);
            }),
            toObject: jest.fn().mockReturnValue({
                ...data,
                _id: "invoice123",
                client: { _id: "client1" }
            })
        };
        return invoice;
    })
}));

// ClientCreditWallet model - FIXED: Add lean() support
jest.unstable_mockModule("../../models/clientCreditWalletModel.js", () => ({
    default: {
        findOne: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                balance: 100
            })
        })
    }
}));

// Contract model
jest.unstable_mockModule("../../models/contractModel.js", () => ({
    default: {
        findOne: jest.fn().mockResolvedValue({
            credit_enabled: true,
            credit_value: 500
        })
    }
}));

// Visitor model
jest.unstable_mockModule("../../models/visitorModel.js", () => ({
    default: {
        create: jest.fn().mockResolvedValue({ _id: "visitor1" })
    }
}));

// Guest model
jest.unstable_mockModule("../../models/guestModel.js", () => ({
    default: {
        create: jest.fn().mockResolvedValue({ _id: "guest1" })
    }
}));

// Payment model
jest.unstable_mockModule("../../models/paymentModel.js", () => ({
    default: {
        create: jest.fn().mockResolvedValue({ _id: "payment1" })
    }
}));

// Contract model - This is already in your file
jest.unstable_mockModule("../../models/contractModel.js", () => ({
    default: {
        findOne: jest.fn().mockResolvedValue({
            credit_enabled: true,
            credit_value: 500
        })
    }
}));

/* ================= IMPORT AFTER MOCK ================= */

const { default: MeetingRoom } = await import("../../models/meetingRoomModel.js");
const { default: MeetingBooking } = await import("../../models/meetingBookingModel.js");
const { default: Building } = await import("../../models/buildingModel.js");
const { default: Member } = await import("../../models/memberModel.js");
const { default: Client } = await import("../../models/clientModel.js");
const { default: Invoice } = await import("../../models/invoiceModel.js");
const { default: ClientCreditWallet } = await import("../../models/clientCreditWalletModel.js");
const { createBooking } = await import("../meetingBookingController.js");
const { default: Contract } = await import('../../models/contractModel.js')

/* ================= HELPER ================= */

const mockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});

// Suppress console errors during tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    // Temporarily suppress expected console errors/warnings
    console.error = jest.fn();
    console.warn = jest.fn();
});

afterAll(() => {
    // Restore console functions
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
});

/* ================= TEST SUITE ================= */

describe("createBooking - Slot Locking & Race Conditions", () => {

    let baseRoom;
    let findByIdMock;
    let populateMock;
    let buildingFindByIdMock;
    let buildingSelectMock;
    let buildingLeanMock;
    let meetingBookingFindOneMock;
    let meetingBookingLeanMock;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup building mock chain
        buildingLeanMock = jest.fn().mockResolvedValue(null);
        buildingSelectMock = jest.fn().mockReturnValue({
            lean: buildingLeanMock
        });
        buildingFindByIdMock = jest.fn().mockReturnValue({
            select: buildingSelectMock
        });
        Building.findById.mockImplementation(buildingFindByIdMock);

        baseRoom = {
            _id: "room1",
            name: "Room A",
            reservedSlots: [],
            status: "active",
            availability: {
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                openTime: "09:00",
                closeTime: "19:00",
                minBookingMinutes: 30,
                maxBookingMinutes: 480
            },
            blackoutDates: [],
            building: "building1",
            pricing: {
                hourlyRate: 500
            },
            communityMaxDiscountPercent: null,
            save: jest.fn().mockResolvedValue(true)
        };

        // Setup meeting room mock chain
        populateMock = jest.fn().mockResolvedValue(baseRoom);
        findByIdMock = jest.fn().mockReturnValue({
            populate: populateMock
        });

        MeetingRoom.findById.mockImplementation(findByIdMock);

        // Setup meeting booking mock chain with lean
        meetingBookingLeanMock = jest.fn();
        meetingBookingFindOneMock = jest.fn().mockReturnValue({
            lean: meetingBookingLeanMock
        });
        MeetingBooking.findOne.mockImplementation(meetingBookingFindOneMock);

        // Reset Invoice mock
        Invoice.mockClear();
    });

    test("should allow only one booking during simulated race", async () => {
        // Mock the conflict check to simulate race condition
        let findOneCallCount = 0;

        meetingBookingLeanMock.mockImplementation(() => {
            findOneCallCount++;
            if (findOneCallCount === 1) {
                return Promise.resolve(null); // First request sees no conflict - FIXED: return promise
            }
            // For subsequent requests, return a conflict
            return Promise.resolve({ _id: "existingBooking" });
        });

        // Mock successful booking creation
        MeetingBooking.create.mockResolvedValue({
            _id: "booking1",
            visitors: [],
            payment: { method: "cash" }
        });

        // Create two identical requests
        const req = {
            body: {
                room: "room1",
                client: "client1",
                paymentMethod: "cash",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T11:00:00+05:30"
            }
        };

        const res1 = mockRes();
        const res2 = mockRes();

        // Execute both requests concurrently
        await Promise.all([
            createBooking(req, res1),
            createBooking(req, res2)
        ]);

        // Check the results
        const statuses = [
            res1.status.mock.calls[0]?.[0],
            res2.status.mock.calls[0]?.[0]
        ];

        console.log('Response statuses:', statuses);

        // One should succeed (201), one should fail (400)
        expect(statuses).toContain(201);
        expect(statuses).toContain(400);

        // Verify that findOne was called multiple times (for conflict checking)
        expect(MeetingBooking.findOne).toHaveBeenCalledTimes(2);
        expect(meetingBookingLeanMock).toHaveBeenCalledTimes(2);

        // Verify that create was called only once (only one booking created)
        expect(MeetingBooking.create).toHaveBeenCalledTimes(1);
    });

    test("should detect overlapping bookings correctly", async () => {
        // Setup to always detect conflict
        meetingBookingLeanMock.mockResolvedValue({ _id: "existingBooking" });

        const req = {
            body: {
                room: "room1",
                client: "client1",
                paymentMethod: "cash",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T11:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Time slot conflicts with an existing booking"
        });

        expect(meetingBookingLeanMock).toHaveBeenCalled();
    });

    test("should handle building operating hours correctly", async () => {
        // Mock building with different hours
        buildingLeanMock.mockResolvedValue({
            openingTime: "10:00",
            closingTime: "18:00"
        });

        // Mock no conflict for availability check
        meetingBookingLeanMock.mockResolvedValue(null);

        const req = {
            body: {
                room: "room1",
                client: "client1",
                paymentMethod: "cash",
                start: "2025-01-01T09:00:00+05:30", // Before building opens
                end: "2025-01-01T10:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: expect.stringContaining("operating hours")
        });
    });

    test("should handle credit payments correctly", async () => {
        // Setup building hours to be open
        buildingLeanMock.mockResolvedValue({
            openingTime: "09:00",
            closingTime: "19:00"
        });

        // Mock no conflict
        meetingBookingLeanMock.mockResolvedValue(null);

        // Mock successful booking creation
        MeetingBooking.create.mockResolvedValue({
            _id: "booking1",
            visitors: [],
            payment: {
                method: "credits",
                coveredCredits: 2
            }
        });

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30" // 2 hours
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(MeetingBooking.create).toHaveBeenCalledTimes(1);
        expect(Invoice).toHaveBeenCalled(); // Invoice should be created for credit payments
    });
});


describe("createBooking - Credit Deduction Logic", () => {
    let baseRoom;
    let findByIdMock;
    let populateMock;
    let buildingFindByIdMock;
    let buildingSelectMock;
    let buildingLeanMock;
    let meetingBookingFindOneMock;
    let meetingBookingLeanMock;
    let walletServiceMock;
    let memberFindByIdMock;
    let contractFindOneMock;
    let clientCreditWalletFindOneMock;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup building mock chain
        buildingLeanMock = jest.fn().mockResolvedValue({
            openingTime: "09:00",
            closingTime: "19:00"
        });
        buildingSelectMock = jest.fn().mockReturnValue({
            lean: buildingLeanMock
        });
        buildingFindByIdMock = jest.fn().mockReturnValue({
            select: buildingSelectMock
        });
        Building.findById.mockImplementation(buildingFindByIdMock);

        baseRoom = {
            _id: "room1",
            name: "Room A",
            reservedSlots: [],
            status: "active",
            availability: {
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                openTime: "09:00",
                closeTime: "19:00",
                minBookingMinutes: 30,
                maxBookingMinutes: 480
            },
            blackoutDates: [],
            building: "building1",
            pricing: {
                hourlyRate: 500
            },
            communityMaxDiscountPercent: null,
            save: jest.fn().mockResolvedValue(true)
        };

        // Setup meeting room mock chain
        populateMock = jest.fn().mockResolvedValue(baseRoom);
        findByIdMock = jest.fn().mockReturnValue({
            populate: populateMock
        });
        MeetingRoom.findById.mockImplementation(findByIdMock);

        // Setup meeting booking mock chain with lean
        meetingBookingLeanMock = jest.fn().mockResolvedValue(null);
        meetingBookingFindOneMock = jest.fn().mockReturnValue({
            lean: meetingBookingLeanMock
        });
        MeetingBooking.findOne.mockImplementation(meetingBookingFindOneMock);

        // Setup member mock - important for credit payments
        memberFindByIdMock = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "active",
                allowedUsingCredits: true,
                client: {
                    _id: "client1",
                    toObject: jest.fn().mockReturnValue({
                        _id: "client1",
                        email: "client@example.com"
                    })
                },
                email: "member@example.com",
                firstName: "Test",
                companyName: "Test Co"
            })
        });
        Member.findById.mockImplementation(memberFindByIdMock);

        // Setup contract mock - provides credit value
        contractFindOneMock = jest.fn().mockResolvedValue({
            credit_enabled: true,
            credit_value: 500
        });
        Contract.findOne = contractFindOneMock;

        // Setup wallet mock - provides balance
        clientCreditWalletFindOneMock = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                balance: 100
            })
        });
        ClientCreditWallet.findOne = clientCreditWalletFindOneMock;

        // Get wallet service mock
        const { default: walletService } = await import("../../services/walletService.js");
        walletServiceMock = walletService;

        // Reset Invoice mock
        Invoice.mockClear();
    });

    test("should successfully deduct credits for a 2-hour booking", async () => {
        // Setup wallet service
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock successful booking creation
        MeetingBooking.create.mockResolvedValueOnce({
            _id: "booking1",
            room: "room1",
            start: new Date("2025-01-01T10:00:00+05:30"),
            end: new Date("2025-01-01T12:00:00+05:30"),
            payment: {
                method: "credits",
                coveredCredits: 2,
                extraCredits: 0,
                overageAmount: 0,
                valuePerCredit: 500
            },
            visitors: [],
            save: jest.fn().mockResolvedValue(true)
        });

        const req = {
            body: {
                room: "room1",
                memberId: "member1",  // Required for credits
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",  // Required for credits
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify member was checked
        expect(Member.findById).toHaveBeenCalledWith("member1");

        // Verify contract was checked for credit value
        expect(Contract.findOne).toHaveBeenCalledWith({
            client: "client1",
            status: "active",
            credit_enabled: true
        });

        // Verify wallet balance was checked
        expect(ClientCreditWallet.findOne).toHaveBeenCalledWith({ client: "client1" });

        // Verify credit consumption was called
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledWith(
            expect.objectContaining({
                clientId: "client1",
                memberId: "member1",
                requiredCredits: expect.any(Number), // Will be calculated based on total
                idempotencyKey: "test-key-123",
                refType: "meeting_booking",
                meta: expect.objectContaining({
                    roomId: "room1",
                    creditValue: 500
                })
            })
        );

        // Verify invoice was created
        expect(Invoice).toHaveBeenCalledTimes(1);

        // Verify booking was created
        expect(MeetingBooking.create).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test("should handle partial credit coverage with overage amount", async () => {
        // Setup wallet with lower balance
        clientCreditWalletFindOneMock = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                balance: 1  // Only 1 credit available
            })
        });
        ClientCreditWallet.findOne = clientCreditWalletFindOneMock;

        // Mock wallet service to return partial coverage
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 1,
            extraCredits: 1,
            overageAmount: 500,
            valuePerCredit: 500
        });

        MeetingBooking.create.mockResolvedValueOnce({
            _id: "booking1",
            room: "room1",
            start: new Date("2025-01-01T10:00:00+05:30"),
            end: new Date("2025-01-01T12:00:00+05:30"),
            payment: {
                method: "credits",
                coveredCredits: 1,
                extraCredits: 1,
                overageAmount: 500
            },
            visitors: [],
            save: jest.fn().mockResolvedValue(true)
        });

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Should pass the balance check (1 credit available, needs 2)
        expect(ClientCreditWallet.findOne).toHaveBeenCalled();
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test("should fail when member is not active", async () => {
        // Mock inactive member
        memberFindByIdMock = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "inactive",  // Inactive member
                allowedUsingCredits: true,
                client: { _id: "client1" }
            })
        });
        Member.findById.mockImplementation(memberFindByIdMock);

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            code: "MEMBER_INACTIVE",
            message: "Member is inactive"
        });
        expect(walletServiceMock.consumeCreditsWithOverdraft).not.toHaveBeenCalled();
        expect(MeetingBooking.create).not.toHaveBeenCalled();
    });

    test("should fail when member is not allowed to use credits", async () => {
        // Mock member not allowed to use credits
        memberFindByIdMock = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "active",
                allowedUsingCredits: false,  // Not allowed to use credits
                client: { _id: "client1" }
            })
        });
        Member.findById.mockImplementation(memberFindByIdMock);

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            code: "CREDITS_NOT_ALLOWED",
            message: "This member is not allowed to use credits"
        });
        expect(walletServiceMock.consumeCreditsWithOverdraft).not.toHaveBeenCalled();
    });

    test("should fail when user has insufficient credits (balance check)", async () => {
        // Clear all mocks first
        jest.clearAllMocks();


        // Setup member mock (required for credit payments)
        memberFindByIdMock = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "active",
                allowedUsingCredits: true,
                client: {
                    _id: "client1",
                    toObject: jest.fn().mockReturnValue({
                        _id: "client1",
                        email: "client@example.com"
                    })
                },
                email: "member@example.com",
                firstName: "Test",
                companyName: "Test Co"
            })
        });
        Member.findById.mockImplementation(memberFindByIdMock);

        // Setup contract mock (must return a valid contract)
        contractFindOneMock = jest.fn().mockResolvedValue({
            credit_enabled: true,
            credit_value: 500
        });
        Contract.findOne = contractFindOneMock;

        // Setup wallet with insufficient balance
        clientCreditWalletFindOneMock = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                balance: 1  // Only 1 credit available
            })
        });
        ClientCreditWallet.findOne = clientCreditWalletFindOneMock;

        // IMPORTANT: Mock computeInvoiceTotals to return a predictable value
        // You need to import and mock this function if it's used
        // Since it's exported from the same file, you might need to mock it differently

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-key-123",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"  // 2-hour booking
            }
        };

        const res = mockRes();

        walletServiceMock.consumeCreditsWithOverdraft
            .mockRejectedValueOnce(new Error("Insufficient credits"));

        try {

            await createBooking(req, res);
        } catch (error) {
            console.log('Caught error:', error);
        }

        // Log what was called
        console.log('Member.findById called:', Member.findById.mock.calls.length);
        console.log('Contract.findOne called:', Contract.findOne.mock.calls.length);
        console.log('ClientCreditWallet.findOne called:', ClientCreditWallet.findOne.mock.calls.length);
        console.log('Response status:', res.status.mock.calls[0]?.[0]);
        console.log('Response body:', res.json.mock.calls[0]?.[0]);

        // The controller should return 400, not throw an error
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: false,
                code: "INSUFFICIENT_CREDITS",
                message: expect.stringContaining("Insufficient credits"),
                required: expect.any(Number),
                available: 1
            })
        );

        expect(walletServiceMock.consumeCreditsWithOverdraft).not.toHaveBeenCalled();
        expect(MeetingBooking.create).not.toHaveBeenCalled();
    });

    test("should handle idempotency for credit bookings", async () => {
        // Setup wallet service
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock findOne to return existing booking for second request (idempotency)
        meetingBookingLeanMock
            .mockResolvedValueOnce(null) // First request - no conflict
            .mockResolvedValueOnce({     // Second request - existing booking found
                _id: "booking1",
                payment: { method: "credits" }
            });

        MeetingBooking.create.mockResolvedValueOnce({
            _id: "booking1",
            payment: { method: "credits" },
            visitors: [],
            save: jest.fn().mockResolvedValue(true)
        });

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "same-key-123", // Same key for both requests
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res1 = mockRes();
        const res2 = mockRes();

        // Execute both requests
        await createBooking(req, res1);
        await createBooking(req, res2);

        // Both should succeed (second returns existing booking)
        expect(res1.status).toHaveBeenCalledWith(201);
        expect(res2.status).toHaveBeenCalledWith(201);

        // Wallet service should only be called once
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);

        // Create should only be called once
        expect(MeetingBooking.create).toHaveBeenCalledTimes(1);
    });

    test("should handle concurrent credit bookings with different idempotency keys", async () => {
        let creditConsumptionCount = 0;

        walletServiceMock.consumeCreditsWithOverdraft.mockImplementation(() => {
            creditConsumptionCount++;
            if (creditConsumptionCount === 1) {
                return Promise.resolve({
                    coveredCredits: 2,
                    extraCredits: 0,
                    overageAmount: 0,
                    valuePerCredit: 500
                });
            } else {
                return Promise.reject(new Error("Insufficient credits"));
            }
        });

        MeetingBooking.create.mockImplementation(() => {
            if (creditConsumptionCount === 1) {
                return Promise.resolve({
                    _id: "booking1",
                    payment: { method: "credits" },
                    visitors: [],
                    save: jest.fn().mockResolvedValue(true)
                });
            }
            return Promise.reject(new Error("Should not be called"));
        });

        // Different idempotency keys for concurrent bookings
        const req1 = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "key-1",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const req2 = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "key-2",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res1 = mockRes();
        const res2 = mockRes();

        // Execute both requests concurrently
        await Promise.all([
            createBooking(req1, res1),
            createBooking(req2, res2)
        ]);

        const statuses = [
            res1.status.mock.calls[0]?.[0],
            res2.status.mock.calls[0]?.[0]
        ];

        // One should succeed, one should fail
        expect(statuses).toContain(201);
        expect(statuses).toContain(400);

        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(2);
        expect(MeetingBooking.create).toHaveBeenCalledTimes(1);
    });

    test("should require idempotency key for credit payments", async () => {
        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                // No idempotencyKey
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "idempotencyKey is required for credit payments"
        });

        expect(walletServiceMock.consumeCreditsWithOverdraft).not.toHaveBeenCalled();
        expect(MeetingBooking.create).not.toHaveBeenCalled();
    });
});




describe("createBooking - Credit Rollback on Failure", () => {
    let baseRoom;
    let findByIdMock;
    let populateMock;
    let buildingFindByIdMock;
    let buildingSelectMock;
    let buildingLeanMock;
    let meetingBookingFindOneMock;
    let meetingBookingLeanMock;
    let walletServiceMock;
    let memberFindByIdMock;
    let contractFindOneMock;
    let clientCreditWalletFindOneMock;
    let zohoBooksMock;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Setup building mock chain
        buildingLeanMock = jest.fn().mockResolvedValue({
            openingTime: "09:00",
            closingTime: "19:00"
        });
        buildingSelectMock = jest.fn().mockReturnValue({
            lean: buildingLeanMock
        });
        buildingFindByIdMock = jest.fn().mockReturnValue({
            select: buildingSelectMock
        });
        Building.findById.mockImplementation(buildingFindByIdMock);

        baseRoom = {
            _id: "room1",
            name: "Room A",
            reservedSlots: [],
            status: "active",
            availability: {
                daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                openTime: "09:00",
                closeTime: "19:00",
                minBookingMinutes: 30,
                maxBookingMinutes: 480
            },
            blackoutDates: [],
            building: "building1",
            pricing: {
                hourlyRate: 500
            },
            communityMaxDiscountPercent: null,
            save: jest.fn().mockResolvedValue(true)
        };

        // Setup meeting room mock chain
        populateMock = jest.fn().mockResolvedValue(baseRoom);
        findByIdMock = jest.fn().mockReturnValue({
            populate: populateMock
        });
        MeetingRoom.findById.mockImplementation(findByIdMock);

        // Setup meeting booking mock chain with lean
        meetingBookingLeanMock = jest.fn().mockResolvedValue(null);
        meetingBookingFindOneMock = jest.fn().mockReturnValue({
            lean: meetingBookingLeanMock
        });
        MeetingBooking.findOne.mockImplementation(meetingBookingFindOneMock);

        // Setup member mock
        memberFindByIdMock = jest.fn().mockReturnValue({
            populate: jest.fn().mockResolvedValue({
                _id: "member1",
                status: "active",
                allowedUsingCredits: true,
                client: {
                    _id: "client1",
                    toObject: jest.fn().mockReturnValue({
                        _id: "client1",
                        email: "client@example.com",
                        zohoBooksContactId: "zoho_contact_123"
                    })
                },
                email: "member@example.com",
                firstName: "Test",
                companyName: "Test Co"
            })
        });
        Member.findById.mockImplementation(memberFindByIdMock);

        // Setup contract mock
        contractFindOneMock = jest.fn().mockResolvedValue({
            credit_enabled: true,
            credit_value: 500
        });
        Contract.findOne = contractFindOneMock;

        // Setup wallet mock
        clientCreditWalletFindOneMock = jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                balance: 100
            })
        });
        ClientCreditWallet.findOne = clientCreditWalletFindOneMock;

        // Get wallet service mock
        const { default: walletService } = await import("../../services/walletService.js");
        walletServiceMock = walletService;

        // Get zoho books mock
        const { createZohoInvoiceFromLocal, recordZohoPayment } = await import("../../utils/zohoBooks.js");
        zohoBooksMock = {
            createZohoInvoiceFromLocal,
            recordZohoPayment
        };

        // Reset Invoice mock
        Invoice.mockClear();
    });

    test("should rollback credits when invoice creation fails", async () => {
        // Setup successful credit consumption
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock invoice creation to fail
        const saveMock = jest.fn().mockRejectedValue(new Error("Invoice creation failed"));
        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock
        }));

        // Setup wallet service rollback spy
        const rollbackSpy = jest.fn().mockResolvedValue({ success: true });
        walletServiceMock.rollbackConsumption = rollbackSpy;

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-rollback-key-1",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify credit consumption was called
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);

        // Verify rollback was called with correct parameters
        expect(rollbackSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                clientId: "client1",
                memberId: "member1",
                idempotencyKey: "test-rollback-key-1",
                refType: "meeting_booking",
                reason: expect.stringContaining("Invoice creation failed")
            })
        );

        // Verify booking was not created
        expect(MeetingBooking.create).not.toHaveBeenCalled();

        // Verify error response
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: expect.stringContaining("Failed to create booking"),
            error: expect.any(String)
        });
    });

    test("should rollback credits when Zoho invoice creation fails", async () => {
        // Setup successful credit consumption
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock successful invoice creation but Zoho failure
        const saveMock = jest.fn().mockResolvedValue({
            _id: "invoice123",
            zoho_invoice_id: null,
            zoho_invoice_number: null
        });
        
        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock
        }));

        // Mock Zoho invoice creation to fail
        zohoBooksMock.createZohoInvoiceFromLocal.mockRejectedValueOnce(
            new Error("Zoho API error")
        );

        // Setup wallet service rollback spy
        const rollbackSpy = jest.fn().mockResolvedValue({ success: true });
        walletServiceMock.rollbackConsumption = rollbackSpy;

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-rollback-key-2",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify credit consumption was called
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);

        // Verify rollback was called
        expect(rollbackSpy).toHaveBeenCalled();

        // Verify booking was not created
        expect(MeetingBooking.create).not.toHaveBeenCalled();

        // Verify error response
        expect(res.status).toHaveBeenCalledWith(500);
    });

    test("should rollback credits when meeting booking creation fails", async () => {
        // Setup successful credit consumption
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock successful invoice creation
        const saveMock = jest.fn().mockResolvedValue({
            _id: "invoice123",
            zoho_invoice_id: "zoho_123",
            zoho_invoice_number: "INV-001"
        });
        
        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock
        }));

        // Mock successful Zoho invoice creation
        zohoBooksMock.createZohoInvoiceFromLocal.mockResolvedValueOnce({
            invoice: {
                invoice_id: "zoho_123",
                invoice_number: "INV-001"
            }
        });

        // Mock meeting booking creation to fail
        MeetingBooking.create.mockRejectedValueOnce(new Error("Database error saving booking"));

        // Setup wallet service rollback spy
        const rollbackSpy = jest.fn().mockResolvedValue({ success: true });
        walletServiceMock.rollbackConsumption = rollbackSpy;

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-rollback-key-3",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify credit consumption was called
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);

        // Verify rollback was called
        expect(rollbackSpy).toHaveBeenCalled();

        // Verify error response
        expect(res.status).toHaveBeenCalledWith(500);
    });

    test("should handle rollback failure gracefully", async () => {
        // Setup successful credit consumption
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock invoice creation to fail
        const saveMock = jest.fn().mockRejectedValue(new Error("Invoice creation failed"));
        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock
        }));

        // Setup wallet service rollback to ALSO fail
        const rollbackSpy = jest.fn().mockRejectedValue(new Error("Rollback also failed"));
        walletServiceMock.rollbackConsumption = rollbackSpy;

        // Spy on logger/console.error
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-rollback-key-4",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify both consumption and rollback were attempted
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);
        expect(rollbackSpy).toHaveBeenCalled();

        // Verify error was logged (should be logged even if rollback fails)
        expect(errorSpy).toHaveBeenCalled();

        // Verify response still indicates failure
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: expect.stringContaining("Failed to create booking")
        });

        errorSpy.mockRestore();
    });

    test("should NOT rollback credits when booking succeeds", async () => {
        // Setup successful credit consumption
        walletServiceMock.consumeCreditsWithOverdraft.mockResolvedValueOnce({
            coveredCredits: 2,
            extraCredits: 0,
            overageAmount: 0,
            valuePerCredit: 500
        });

        // Mock successful invoice creation
        const saveMock = jest.fn().mockResolvedValue({
            _id: "invoice123",
            zoho_invoice_id: "zoho_123",
            zoho_invoice_number: "INV-001"
        });
        
        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock
        }));

        // Mock successful Zoho invoice creation
        zohoBooksMock.createZohoInvoiceFromLocal.mockResolvedValueOnce({
            invoice: {
                invoice_id: "zoho_123",
                invoice_number: "INV-001"
            }
        });

        // Mock successful meeting booking creation
        MeetingBooking.create.mockResolvedValueOnce({
            _id: "booking1",
            room: "room1",
            start: new Date("2025-01-01T10:00:00+05:30"),
            end: new Date("2025-01-01T12:00:00+05:30"),
            payment: {
                method: "credits",
                coveredCredits: 2
            },
            visitors: [],
            save: jest.fn().mockResolvedValue(true)
        });

        // Setup rollback spy
        const rollbackSpy = jest.fn().mockResolvedValue({ success: true });
        walletServiceMock.rollbackConsumption = rollbackSpy;

        const req = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "test-success-key",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const res = mockRes();
        await createBooking(req, res);

        // Verify credit consumption was called
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(1);

        // Verify rollback was NOT called
        expect(rollbackSpy).not.toHaveBeenCalled();

        // Verify success response
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test("should handle concurrent requests with rollback correctly", async () => {
        let consumptionCount = 0;
        
        // Setup credit consumption to succeed for first request only
        walletServiceMock.consumeCreditsWithOverdraft.mockImplementation(() => {
            consumptionCount++;
            if (consumptionCount === 1) {
                return Promise.resolve({
                    coveredCredits: 2,
                    extraCredits: 0,
                    overageAmount: 0,
                    valuePerCredit: 500
                });
            }
            return Promise.reject(new Error("Insufficient credits"));
        });

        // Setup invoice creation to fail for first request only
        const saveMock1 = jest.fn().mockRejectedValue(new Error("Invoice creation failed"));
        const saveMock2 = jest.fn().mockResolvedValue({
            _id: "invoice456",
            zoho_invoice_id: "zoho_456",
            zoho_invoice_number: "INV-002"
        });

        Invoice.mockImplementationOnce(() => ({
            _id: "invoice123",
            save: saveMock1
        })).mockImplementationOnce(() => ({
            _id: "invoice456",
            save: saveMock2
        }));

        // Setup Zoho success for second request
        zohoBooksMock.createZohoInvoiceFromLocal
            .mockRejectedValueOnce(new Error("Should not be called for first request"))
            .mockResolvedValueOnce({
                invoice: {
                    invoice_id: "zoho_456",
                    invoice_number: "INV-002"
                }
            });

        // Setup rollback spy
        const rollbackSpy = jest.fn().mockResolvedValue({ success: true });
        walletServiceMock.rollbackConsumption = rollbackSpy;

        const req1 = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "key-1",
                start: "2025-01-01T10:00:00+05:30",
                end: "2025-01-01T12:00:00+05:30"
            }
        };

        const req2 = {
            body: {
                room: "room1",
                memberId: "member1",
                paymentMethod: "credits",
                idempotencyKey: "key-2",
                start: "2025-01-01T14:00:00+05:30",
                end: "2025-01-01T16:00:00+05:30"
            }
        };

        const res1 = mockRes();
        const res2 = mockRes();

        // Execute both requests concurrently
        await Promise.all([
            createBooking(req1, res1),
            createBooking(req2, res2)
        ]);

        // Verify credit consumption attempts
        expect(walletServiceMock.consumeCreditsWithOverdraft).toHaveBeenCalledTimes(2);

        // Verify rollback was called for the failed request only
        expect(rollbackSpy).toHaveBeenCalledTimes(1);
        expect(rollbackSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                idempotencyKey: "key-1"
            })
        );

        // Verify results
        const statuses = [
            res1.status.mock.calls[0]?.[0],
            res2.status.mock.calls[0]?.[0]
        ];

        expect(statuses).toContain(500); // First request fails (invoice error)
        expect(statuses).toContain(201); // Second request succeeds
    });
});