import Client from '../models/clientModel.js';
import Contract from '../models/contractModel.js';
import Cabin from '../models/cabinModel.js';
import SecurityDeposit from '../models/securityDepositModel.js';
import Invoice from '../models/invoiceModel.js';
import Member from '../models/memberModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import DocumentEntity from '../models/documentEntityModel.js';
import Payment from '../models/paymentModel.js';
import MatrixUser from "../models/matrixUserModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import AccessPoint from "../models/accessPointModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import imagekit from '../utils/imageKit.js';
import { findOrCreateContactFromClient, createZohoInvoiceFromLocal } from '../utils/zohoBooks.js';
import { generateLocalInvoiceNumber } from '../utils/invoiceNumberGenerator.js';
import { logCRUDActivity, logErrorActivity } from '../utils/activityLogger.js';
import { sendNotification } from "../utils/notificationHelper.js";
import { matrixApi } from "../utils/matrixApi.js";
import { ensureBhaifiForMember } from "../controllers/bhaifiController.js";

// --- Progress Tracking ---
export const getMigrationStatus = async (req, res) => {
    try {
        const { email, clientId } = req.query;
        if (!email && !clientId) return res.status(400).json({ success: false, message: 'Email or Client ID required' });

        let client;
        if (clientId) {
            client = await Client.findById(clientId);
        } else {
            client = await Client.findOne({ email });
        }

        if (!client) return res.json({ success: true, currentStep: 1 });

        // Fetch Summary Data
        const [contract, membersCount, invoices] = await Promise.all([
            Contract.findOne({ client: client._id }).sort({ createdAt: -1 }),
            Member.countDocuments({ client: client._id }),
            Invoice.find({ client: client._id })
        ]);

        const documentCount = client.kycDocumentItems?.length || 0;
        const invoiceTotal = invoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

        const cabin = contract ? await Cabin.findOne({ contract: contract._id }) : null;

        // Determine current step based on data presence
        let currentStep = 2; // Step 1 is done if client exists
        if (client.kycStatus === 'verified') currentStep = 3;
        if (contract) currentStep = 4;
        if (cabin) currentStep = 5;
        // Invoices are created in Step 5. We'll check if any exist (besides SD invoice maybe?)
        // Migration usually creates multiple. If invoices > 0, probably Step 5 is done.
        if (invoices.length > 0) currentStep = 6;
        if (membersCount > 1) currentStep = 7; // Assuming 1 member is the owner created in Step 1

        return res.json({
            success: true,
            currentStep,
            clientId: client._id,
            contractId: contract?._id,
            client,
            contract,
            cabin,
            summary: {
                documentsCount: documentCount,
                invoicesCount: invoices.length,
                invoicesTotal: invoiceTotal,
                membersCount: membersCount
            }
        });

    } catch (error) {
        console.error('getMigrationStatus error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 1: Client ---
export const saveClientStep = async (req, res) => {
    try {
        const { client: clientData, clientId } = req.body;

        // 1. Zoho Sync
        let zohoBooksContactId = clientData.zohoBooksContactId;
        if (!zohoBooksContactId) {
            const tempClient = {
                ...clientData,
                email: clientData.email,
                companyName: clientData.companyName,
                contactPerson: clientData.contactPerson,
                phone: clientData.phone,
                gstNo: clientData.gstNo,
                billingAddress: clientData.billingAddress || {}
            };
            if (!tempClient.contactPerson && clientData.firstName) {
                tempClient.contactPerson = `${clientData.firstName} ${clientData.lastName}`.trim();
            }
            zohoBooksContactId = await findOrCreateContactFromClient(tempClient);
        }

        const payload = {
            // Basic
            companyName: clientData.companyName,
            legalName: clientData.legalName,
            contactPerson: clientData.contactPerson || `${clientData.firstName || ''} ${clientData.lastName || ''}`.trim(),
            primarySalutation: clientData.salutation,
            primaryFirstName: clientData.firstName,
            primaryLastName: clientData.lastName,
            email: clientData.email,
            phone: clientData.phone,
            website: clientData.website,
            industry: clientData.industry,

            // Commercial
            contactType: clientData.contactType || 'customer',
            customerSubType: clientData.customerSubType || 'business',
            gender: clientData.gender,

            // Addresses
            billingAddress: clientData.billingAddress || {},
            shippingAddress: clientData.shippingAddress || {},

            // Tax
            gstTreatment: clientData.gstTreatment,
            gstNo: clientData.gstNo,
            placeOfContact: clientData.placeOfContact,

            // Contacts & Authority
            contactPersons: clientData.contactPersons || [],
            authoritySignee: clientData.authoritySignee,
            isPrimaryContactauthoritySignee: clientData.isPrimaryContactauthoritySignee,

            // System
            zohoBooksContactId,
            membershipStatus: 'active',
            isClientApproved: true,
            // Don't overwrite kycStatus if it exists and is verified
        };

        let client;
        let isNew = false;

        if (clientId) {
            client = await Client.findByIdAndUpdate(clientId, { $set: payload }, { new: true });
        } else {
            // Create new
            client = await Client.create(payload);
            isNew = true;
        }

        if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

        // User Creation Logic (only for new or if missing)
        if (!client.ownerUser && client.email) {
            try {
                let roleClient = await Role.findOne({ roleName: { $regex: /^client$/i } });
                if (!roleClient) roleClient = await Role.create({ roleName: "client", permissions: [] });

                let user = await User.findOne({
                    $or: [{ email: client.email }, { phone: client.phone }]
                });

                if (!user) {
                    const name = client.contactPerson?.trim() || client.companyName?.trim() || "Client User";
                    user = await User.create({
                        role: roleClient._id,
                        name,
                        email: client.email,
                        phone: client.phone,
                        password: '123456', // Default password
                    });
                } else if (!user.role) {
                    user.role = roleClient._id;
                    await user.save();
                }
                client.ownerUser = user._id;
                await client.save();

                // Owner Member
                const existingMember = await Member.findOne({ client: client._id, user: user._id });
                if (!existingMember) {
                    await Member.create({
                        firstName: (client.contactPerson || "Owner").trim(),
                        lastName: "",
                        email: client.email,
                        phone: client.phone,
                        role: "owner",
                        client: client._id,
                        user: user._id,
                        status: "active",
                    });
                }
            } catch (e) {
                console.error('Error creating user for client:', e);
            }
        }

        if (isNew) {
            await logCRUDActivity(req, 'CREATE', 'Client', client._id, null, { source: 'migration_step1', email: client.email });
        } else {
            await logCRUDActivity(req, 'UPDATE', 'Client', client._id, null, { source: 'migration_step1' });
        }

        return res.json({ success: true, clientId: client._id, client });

    } catch (error) {
        console.error('saveClientStep error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 2: Documents ---
export const saveDocumentsStep = async (req, res) => {
    try {
        const { clientId } = req.body;
        if (!clientId) return res.status(400).json({ success: false, message: 'Client ID required' });

        const files = Array.isArray(req.files) ? req.files : [];
        const kycDocumentItems = [];

        if (files.length > 0) {
            const uploadsByField = {};
            await Promise.all(files.map(async (f) => {
                const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
                try {
                    const result = await imagekit.upload({
                        file: f.buffer,
                        fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
                        folder,
                    });
                    const entry = {
                        fieldname: f.fieldname,
                        originalname: f.originalname,
                        url: result?.url,
                    };
                    if (!uploadsByField[f.fieldname]) uploadsByField[f.fieldname] = [];
                    uploadsByField[f.fieldname].push(entry);
                } catch (err) {
                    console.error('ImageKit upload error:', err);
                }
            }));

            const docEntities = await DocumentEntity.find({ isActive: true }).lean();
            const byField = new Map(docEntities.map(d => [d.fieldName, d]));

            for (const [fieldName, arr] of Object.entries(uploadsByField)) {
                const ent = byField.get(fieldName);
                for (const f of arr) {
                    kycDocumentItems.push({
                        document: ent ? ent._id : null,
                        fieldName,
                        fileName: f.originalname,
                        url: f.url,
                        password: req.body[`${fieldName}_password`] || undefined,
                        notes: req.body[`${fieldName}_notes`] || undefined,
                        approved: true, // Auto-approve
                        uploadedAt: new Date(),
                    });
                }
            }
        }

        if (kycDocumentItems.length > 0) {
            await Client.findByIdAndUpdate(clientId, {
                $push: { kycDocumentItems: { $each: kycDocumentItems } },
                $set: { kycStatus: 'verified' }
            });
            await logCRUDActivity(req, 'UPDATE', 'Client', clientId, null, { source: 'migration_step2', docsAdded: kycDocumentItems.length });
        }

        return res.json({ success: true, message: 'Documents saved' });
    } catch (error) {
        console.error('saveDocumentsStep error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 3: Contract ---
export const saveContractStep = async (req, res) => {
    try {
        let { clientId, contractId, contract: contractData } = req.body;
        if (!clientId) return res.status(400).json({ success: false, message: 'Client ID required' });

        // Parse JSON if sent as string from FormData
        if (typeof contractData === 'string') {
            try {
                contractData = JSON.parse(contractData);
            } catch (e) {
                return res.status(400).json({ success: false, message: 'Invalid contract data format' });
            }
        }

        const files = Array.isArray(req.files) ? req.files : [];
        let signedContractUrl = null;
        let depositImageUrls = [];

        // Handle File Uploads
        await Promise.all(files.map(async (f) => {
            const folder = process.env.IMAGEKIT_KYC_FOLDER || "/ofis-square/kyc";
            try {
                const result = await imagekit.upload({
                    file: f.buffer,
                    fileName: f.originalname || `${Date.now()}_${f.fieldname}`,
                    folder: f.fieldname === 'depositImages' ? "/ofis-square/deposits" : folder,
                });

                if (f.fieldname === 'signedContract') {
                    signedContractUrl = result?.url;
                } else if (f.fieldname === 'depositImages') {
                    depositImageUrls.push(result?.url);
                }
            } catch (err) {
                console.error('ImageKit upload error in Step 3:', err);
            }
        }));

        const payload = {
            client: clientId,
            building: contractData.building,
            startDate: contractData.startDate ? new Date(contractData.startDate) : undefined,
            endDate: contractData.endDate ? new Date(contractData.endDate) : undefined,
            billingStartDate: contractData.billingStartDate ? new Date(contractData.billingStartDate) : undefined,
            billingEndDate: contractData.billingEndDate ? new Date(contractData.billingEndDate) : undefined,
            monthlyRent: Number(contractData.monthlyRent || 0),
            capacity: Number(contractData.capacity || 0),

            // Extended fields
            initialCredits: Number(contractData.initialCredits || 0),
            printerCredits: Number(contractData.printerCredits || 0),
            legalExpenses: Number(contractData.legalExpenses || 1200),
            allocationSeatsNumber: Number(contractData.allocationSeatsNumber || 0),
            parkingSpaces: contractData.parkingSpaces || { noOf2WheelerParking: 0, noOf4WheelerParking: 0 },
            parkingFees: contractData.parkingFees || { twoWheeler: 1500, fourWheeler: 5000 },
            durationMonths: Number(contractData.durationMonths || 12),
            lockInPeriodMonths: Number(contractData.lockInPeriodMonths || 12),
            noticePeriodDays: Number(contractData.noticePeriodDays || 30),
            escalation: contractData.escalation || { ratePercent: 0, frequencyMonths: 12 },
            renewal: contractData.renewal || { isAutoRenewal: false, renewalTermMonths: 12 },
            fullyServicedBusinessHours: contractData.fullyServicedBusinessHours || {
                startTime: '09:00',
                endTime: '18:00',
                days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            },
            cleaningAndRestorationFees: Number(contractData.cleaningAndRestorationFees || 2000),

            status: 'active',
            workflowMode: 'custom',

            // Approvals - All true for migration
            iskycuploaded: true,
            iskycapproved: true,
            adminapproved: true,
            legalteamapproved: true,
            clientapproved: true,
            financeapproved: true,
            isclientsigned: !!signedContractUrl || true,
            isfinalapproval: true,
            securitydeposited: Number(contractData.depAgreedAmount) > 0,

            fileUrl: signedContractUrl || undefined,
            createdBy: req.user?._id
        };

        // Also update Client building
        await Client.findByIdAndUpdate(clientId, { $set: { building: contractData.building } });

        let contract;
        if (contractId) {
            contract = await Contract.findByIdAndUpdate(contractId, { $set: payload }, { new: true });
        } else {
            contract = await Contract.create(payload);
        }

        if (!contract) return res.status(404).json({ success: false, message: 'Contract creation failed' });

        // --- Security Deposit Logic ---
        if (Number(contractData.depAgreedAmount) > 0) {
            const agreedAmount = Math.round(Number(contractData.depAgreedAmount));
            const paidAmount = Math.round(Number(contractData.depPayNowAmount || 0));

            let sd = await SecurityDeposit.findOne({ contract: contract._id });
            if (!sd) {
                sd = await SecurityDeposit.create({
                    client: clientId,
                    contract: contract._id,
                    building: contract.building,
                    agreed_amount: agreedAmount,
                    amount_paid: paidAmount,
                    status: paidAmount >= agreedAmount ? 'PAID' : (agreedAmount > 0 ? 'DUE' : 'AGREED'),
                    paid_date: paidAmount > 0 ? new Date(contractData.depPaidDate || Date.now()) : undefined,
                    notes: contractData.notes || 'Migrated Security Deposit',
                    images: depositImageUrls
                });
            } else {
                sd.agreed_amount = agreedAmount;
                sd.amount_paid = paidAmount;
                sd.images = [...new Set([...(sd.images || []), ...depositImageUrls])];
                sd.status = paidAmount >= agreedAmount ? 'PAID' : (agreedAmount > 0 ? 'DUE' : 'AGREED');
                await sd.save();
            }

            contract.securityDeposit = sd._id;
            contract.securitydeposited = true;
            await contract.save();

            // Create Payment if paid
            if (paidAmount > 0) {
                await Payment.create({
                    client: clientId,
                    contract: contract._id,
                    amount: paidAmount,
                    paymentDate: new Date(contractData.depPaidDate || Date.now()),
                    type: contractData.depPaymentType || 'Cash',
                    referenceNumber: contractData.depPaymentRef,
                    status: 'success',
                    notes: 'Migration Security Deposit Payment',
                    images: depositImageUrls
                });
            }
        }

        await logCRUDActivity(req, contractId ? 'UPDATE' : 'CREATE', 'Contract', contract._id, null, { source: 'migration_step3' });

        return res.json({ success: true, contractId: contract._id, contract });
    } catch (error) {
        console.error('saveContractStep error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 4: Cabin ---
export const saveCabinStep = async (req, res) => {
    try {
        const { clientId, contractId, cabin } = req.body;
        if (!clientId || !contractId) return res.status(400).json({ success: false, message: 'IDs required' });

        if (cabin && cabin.selectedCabinId) {
            const cabinDoc = await Cabin.findById(cabin.selectedCabinId);
            if (cabinDoc) {
                // If it was already allocated to this client/contract, no-op or update
                if (cabinDoc.allocatedTo?.toString() !== clientId || cabinDoc.contract?.toString() !== contractId) {
                    cabinDoc.status = 'occupied';
                    cabinDoc.allocatedTo = clientId;
                    cabinDoc.contract = contractId;
                    cabinDoc.allocatedAt = new Date(); // or contract start date
                    await cabinDoc.save();

                    await logCRUDActivity(req, 'UPDATE', 'Cabin', cabinDoc._id, null, { source: 'migration_step4', allocatedTo: clientId });
                }
            }
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('saveCabinStep error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 5: Members ---
export const saveMembersStep = async (req, res) => {
    try {
        const { clientId, contractId, members, contract: contractInfo } = req.body;
        if (!clientId || !contractId) return res.status(400).json({ success: false, message: 'IDs required' });

        const contract = await Contract.findById(contractId);
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
        const buildingId = contract.building;

        const createdMembers = [];
        if (Array.isArray(members) && members.length > 0) {
            for (const mData of members) {
                // Find existing member by email OR create new
                let member = await Member.findOne({ client: clientId, email: mData.email?.toLowerCase() });
                let createdUserId = null;
                const name = `${mData.firstName} ${mData.lastName || ''}`.trim();

                if (!member) {
                    // 1. Create User if email provided
                    if (mData.email) {
                        try {
                            const defaultPassword = "123456";
                            const userData = {
                                name,
                                email: mData.email.toLowerCase(),
                                phone: mData.phone || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                password: defaultPassword,
                                role: mData.role // Selected role from dropdown
                            };

                            const createdUser = await User.create(userData);
                            createdUserId = createdUser._id;

                            // Notify member about platform access
                            try {
                                await sendNotification({
                                    to: { email: mData.email, userId: createdUserId },
                                    channels: { email: true, sms: false },
                                    templateKey: 'platform_access_welcome',
                                    templateVariables: {
                                        greeting: 'Ofis Square',
                                        memberName: name,
                                        companyName: 'Ofis Square',
                                        loginId: mData.email,
                                        password: defaultPassword,
                                        portalLink: process.env.PORTAL_URL || 'https://portal.ofissquare.com'
                                    },
                                    title: 'Welcome to Ofis Square Portal',
                                    metadata: { category: 'onboarding', tags: ['platform_access', 'welcome'] },
                                    source: 'system',
                                    type: 'transactional'
                                });
                            } catch (notifyErr) {
                                console.warn('saveMembersStep: notification failed:', notifyErr?.message);
                            }
                        } catch (userErr) {
                            console.warn("Failed to create user for member:", userErr.message);
                            if (userErr.code === 11000) {
                                const existingUser = await User.findOne({ email: mData.email.toLowerCase() });
                                if (existingUser) {
                                    createdUserId = existingUser._id;
                                    if (!existingUser.role && mData.role) {
                                        existingUser.role = mData.role;
                                        await existingUser.save();
                                    }
                                }
                            }
                        }
                    }

                    // 2. Create Member
                    member = await Member.create({
                        firstName: mData.firstName,
                        lastName: mData.lastName,
                        email: mData.email,
                        phone: mData.phone,
                        role: mData.role, // role ID
                        status: mData.status || 'active',
                        client: clientId,
                        contract: contractId,
                        building: buildingId,
                        user: createdUserId
                    });
                } else {
                    // Update existing member (likely Owner created in Step 1)
                    member.firstName = mData.firstName || member.firstName;
                    member.lastName = mData.lastName || member.lastName;
                    member.phone = mData.phone || member.phone;
                    member.role = mData.role || member.role;
                    member.contract = contractId;
                    member.building = buildingId;
                    await member.save();
                }

                // 3. Provisioning (Matrix & Bhaifi)
                if (mData.access?.matrix) {
                    try {
                        let matrixUserId = member.matrixExternalUserId;
                        if (!matrixUserId) {
                            const random6 = Math.floor(100000 + Math.random() * 900000);
                            matrixUserId = `MEM${random6}`;
                        }

                        try {
                            await matrixApi.createUser({
                                id: matrixUserId,
                                name: name || undefined,
                                email: mData.email || undefined,
                                phone: mData.phone || undefined,
                                status: "active",
                            });
                        } catch (e) {
                            console.warn("Matrix API createUser failed", e.message);
                        }

                        const mu = await MatrixUser.findOneAndUpdate(
                            { externalUserId: matrixUserId },
                            {
                                $setOnInsert: {
                                    externalUserId: matrixUserId,
                                    name,
                                    email: mData.email || undefined,
                                    phone: mData.phone || undefined,
                                    status: 'active',
                                },
                                $set: { buildingId, clientId, memberId: member._id },
                            },
                            { upsert: true, new: true }
                        );

                        await Member.findByIdAndUpdate(member._id, {
                            $set: { matrixUser: mu._id, matrixExternalUserId: mu.externalUserId },
                        });

                        await ProvisioningJob.create({
                            vendor: 'MATRIX_COSEC',
                            jobType: 'UPSERT_USER',
                            buildingId,
                            memberId: member._id,
                            payload: {
                                externalUserId: matrixUserId,
                                name,
                                email: mData.email || undefined,
                                phone: mData.phone || undefined,
                                status: 'active',
                                source: 'MIGRATION_AUTO_PROVISION',
                            },
                        });

                        // Device mapping (Best effort)
                        try {
                            const policyDoc = await AccessPolicy.findOne({ buildingId }).select('accessPointIds').lean();
                            if (policyDoc?.accessPointIds?.length) {
                                const aps = await AccessPoint.find({ _id: { $in: policyDoc.accessPointIds } }).select('deviceBindings').lean();
                                for (const ap of aps) {
                                    for (const b of ap?.deviceBindings || []) {
                                        if (b?.vendor === 'MATRIX_COSEC' && b?.deviceId) {
                                            const dev = await MatrixDevice.findById(b.deviceId).select('device_id').lean();
                                            if (dev?.device_id) {
                                                await matrixApi.assignUserToDevice({ device_id: dev.device_id, externalUserId: matrixUserId });
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) { console.warn("Matrix device assignment failure", e.message); }
                    } catch (e) {
                        console.warn("Matrix flow failure", e.message);
                    }
                }

                if (mData.access?.bhaifi) {
                    try {
                        const bhaifiDoc = await ensureBhaifiForMember({ memberId: member._id, contractId });
                        if (bhaifiDoc?._id) {
                            await Member.findByIdAndUpdate(member._id, {
                                $set: { bhaifiUser: bhaifiDoc._id, bhaifiUserName: bhaifiDoc.userName },
                            });
                        }
                    } catch (e) {
                        console.warn('Bhaifi flow failure', e.message);
                    }
                }

                createdMembers.push(member);
            }

            if (createdMembers.length > 0) {
                await logCRUDActivity(req, 'CREATE', 'Member', null, null, { source: 'migration_step5_detailed', count: createdMembers.length, clientId });
            }
        }

        return res.json({ success: true, count: createdMembers.length });
    } catch (error) {
        console.error('saveMembersStep detailed error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Step 6: Financials ---
// Helper for totals
function computeMigrationInvoiceTotals(inv) {
    const subtotal = inv.line_items.reduce((sum, it) => sum + (Number(it.quantity || 0) * Number(it.unitPrice || 0)), 0);
    const discountValue = Number(inv.discount || 0);
    const taxableBase = Math.max(0, subtotal - discountValue);
    const taxRate = Number(inv.line_items[0]?.tax_percentage || 0);
    const taxAmount = (taxableBase * taxRate) / 100;
    const total = taxableBase + taxAmount;

    return {
        subtotal: subtotal.toFixed(2),
        tax_total: taxAmount.toFixed(2),
        total: total.toFixed(2),
        line_items: inv.line_items.map(it => ({
            ...it,
            amount: (Number(it.quantity) * Number(it.unitPrice)).toFixed(2)
        }))
    };
}

// --- Step 6: Financials ---
export const saveFinancialsStep = async (req, res) => {
    try {
        const { clientId, contractId, invoices, contract: contractData } = req.body;
        if (!clientId || !contractId) return res.status(400).json({ success: false, message: 'IDs required' });

        const [client, contract] = await Promise.all([
            Client.findById(clientId),
            Contract.findById(contractId)
        ]);

        if (!client || !contract) return res.status(404).json({ success: false, message: 'Client or Contract not found' });

        // Security Deposit (Always create if not exists and marked in contractData)
        let securityDeposit = await SecurityDeposit.findOne({ contract: contractId });
        if (!securityDeposit && contractData && Number(contractData.securityDeposit) > 0) {
            const sdData = {
                client: clientId,
                contract: contractId,
                building: contractData.building,
                agreed_amount: Number(contractData.securityDeposit),
                status: 'PAID', // Migration SD usually assumed paid or handled in step 3
                amount_due: 0,
                amount_paid: Number(contractData.securityDeposit),
                paid_date: new Date()
            };

            securityDeposit = await SecurityDeposit.create(sdData);
            await Client.findByIdAndUpdate(clientId, { securityDeposit: securityDeposit._id });
            await Contract.findByIdAndUpdate(contractId, { securityDeposit: securityDeposit._id });

            await logCRUDActivity(req, 'CREATE', 'SecurityDeposit', securityDeposit._id, null, { source: 'migration_step6' });
        }

        // Process Invoices
        const processedInvoices = [];
        if (Array.isArray(invoices) && invoices.length > 0) {
            for (const inv of invoices) {
                const totals = computeMigrationInvoiceTotals(inv);

                // Idempotency check: Skip if an invoice with same billing period and total already exists for this client
                const existingInvoice = await Invoice.findOne({
                    client: clientId,
                    'billing_period.start': new Date(inv.billingPeriod.start),
                    'billing_period.end': new Date(inv.billingPeriod.end),
                    total: Number(totals.total)
                });

                if (existingInvoice) {
                    processedInvoices.push(existingInvoice);
                    continue;
                }

                const localInvoiceNumber = await generateLocalInvoiceNumber();

                const invoiceData = {
                    invoice_number: localInvoiceNumber,
                    client: clientId,
                    contract: contractId,
                    building: contractData?.building || contract.building,
                    date: new Date(inv.issueDate),
                    due_date: new Date(inv.dueDate),
                    billing_period: {
                        start: new Date(inv.billingPeriod.start),
                        end: new Date(inv.billingPeriod.end),
                    },
                    line_items: totals.line_items.map(it => ({
                        description: it.description,
                        quantity: Number(it.quantity),
                        unitPrice: Number(it.unitPrice),
                        amount: Number(it.amount),
                        name: it.description,
                        rate: Number(it.unitPrice),
                        unit: "nos",
                        item_total: Number(it.amount),
                        tax_percentage: Number(it.tax_percentage)
                    })),
                    sub_total: Number(totals.subtotal),
                    tax_total: Number(totals.tax_total),
                    total: Number(totals.total),
                    balance: 0, // Migrated invoices usually assumed paid
                    amount_paid: Number(totals.total),
                    status: 'paid',
                    notes: inv.notes || 'Migrated Invoice',
                    reference_number: inv.reference_number,
                    source: 'migration',
                    gst_no: client.gstNo || undefined,
                    place_of_supply: client.billingAddress?.state_code || undefined,
                    gst_treatment: client.gstTreatment || 'business_gst'
                };

                const invoice = await Invoice.create(invoiceData);
                processedInvoices.push(invoice);

                // Push to Zoho
                try {
                    if (!client.zohoBooksContactId) {
                        const contactId = await findOrCreateContactFromClient(client);
                        if (contactId) {
                            client.zohoBooksContactId = contactId;
                            await client.save();
                        }
                    }

                    if (client.zohoBooksContactId) {
                        const zohoResp = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject());
                        if (zohoResp?.invoice?.invoice_id) {
                            invoice.zoho_invoice_id = zohoResp.invoice.invoice_id;
                            invoice.zoho_invoice_number = zohoResp.invoice.invoice_number;
                            invoice.source = 'zoho';
                            await invoice.save();
                        }
                    }
                } catch (zohoErr) {
                    console.error('Zoho Push failed for migrated invoice:', zohoErr.message);
                    // We don't fail migration if Zoho push fails, just log it
                }
            }
        }

        if (processedInvoices.length > 0) {
            await logCRUDActivity(req, 'CREATE', 'Invoice', null, null, { source: 'migration_step6', count: processedInvoices.length, clientId });
        }

        return res.json({ success: true, count: processedInvoices.length });
    } catch (error) {
        console.error('saveFinancialsStep error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
