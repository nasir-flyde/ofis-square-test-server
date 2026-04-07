import mongoose from 'mongoose';
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
import Building from '../models/buildingModel.js';
import AddOn from '../models/addOnModel.js';
import imagekit from '../utils/imageKit.js';
import ClientCreditWallet from '../models/clientCreditWalletModel.js';
import {
    findOrCreateContactFromClient,
    createZohoInvoiceFromLocal,
    recordZohoPayment,
    deleteZohoInvoice,
    deleteZohoPayment,
    updateContact,
    getContacts
} from '../utils/zohoBooks.js';
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { ensureSecurityDepositHierarchy, recordSDAgreementJournal, recordSDPaymentJournal } from "../services/securityDepositCOAService.js";
import { logCRUDActivity, logErrorActivity } from '../utils/activityLogger.js';
import { sendNotification } from "../utils/notificationHelper.js";
import { matrixApi } from "../utils/matrixApi.js";
import { ensureBhaifiForMember } from "../controllers/bhaifiController.js";
import { ensureDefaultAccessPolicyForContract } from "../services/accessPolicyService.js";
import { grantOnContractActivation } from "../services/accessService.js";
import { applyPaymentToDeposit } from './securityDepositController.js';

const mapPaymentType = (type) => {
    const t = (type || '').trim().toUpperCase();
    if (['RTGS', 'NEFT', 'IMPS', 'BANK TRANSFER', 'BANKTRANSFER', 'INTERNAL TRANSFER', 'WIRE', 'DIRECT DEPOSIT'].includes(t)) {
        return 'Bank Transfer';
    }
    if (['CASH'].includes(t)) return 'Cash';
    if (['UPI'].includes(t)) return 'UPI';
    if (['CHEQUE', 'CHECK'].includes(t)) return 'Cheque';
    if (['CARD', 'CREDIT CARD', 'DEBIT CARD', 'CREDITCARD', 'DEBITCARD'].includes(t)) return 'Card';
    return 'Bank Transfer'; // Default for migration
};

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
        let zohoBooksContactId = clientData.zohoBooksContactId;

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

        if (!zohoBooksContactId) {
            zohoBooksContactId = await findOrCreateContactFromClient(tempClient);
        } else {
            // Also update Zoho Books if it exists
            try {
                // Find or prepare payload for update
                await findOrCreateContactFromClient(tempClient, zohoBooksContactId);
            } catch (e) {
                console.error("Failed to update zoho books contact", e);
            }
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
            membershipStatus: true,
            isClientApproved: true,
            isMigrated: true,
            // Don't overwrite kycStatus if it exists and is verified
        };

        let client;
        let isNew = false;

        if (clientId) {
            client = await Client.findByIdAndUpdate(clientId, { $set: payload }, { new: true });
        } else {
            const clientQueryOpts = [];
            if (payload.email) clientQueryOpts.push({ email: payload.email });
            if (payload.phone) clientQueryOpts.push({ phone: payload.phone });

            let existingClient = null;
            if (clientQueryOpts.length > 0) {
                existingClient = await Client.findOne({ $or: clientQueryOpts });
            }

            if (existingClient) {
                client = await Client.findByIdAndUpdate(existingClient._id, { $set: payload }, { new: true });
            } else {
                client = await Client.create(payload);
                isNew = true;
            }
        }

        if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

        // User Creation Logic (only for new or if missing)
        if (!client.ownerUser && client.email) {
            try {
                let roleClient = await Role.findOne({ roleName: { $regex: /^client$/i } });
                if (!roleClient) roleClient = await Role.create({ roleName: "client", permissions: [] });

                let user = await User.findOne({ email: client.email });

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

                // Ensure COA Hierarchy and Record Journal for migrated SD via applyPaymentToDeposit
                try {
                    await ensureSecurityDepositHierarchy(contract.building, clientId);
                    if (paidAmount > 0) {
                        // This will create SecurityDepositPayment record and Zoho Journal
                        // Note: we pass 0 for amountApplied IF we already updated sd.amount_paid, 
                        // but it's better to let applyPaymentToDeposit do the update.
                        // Let's reset sd.amount_paid to agreedAmount - paidAmount before calling? 
                        // Actually, I'll just let applyPaymentToDeposit handle it and remove the manual update above.
                        sd.amount_paid = Number(sd.amount_paid || 0) - paidAmount; 
                        await applyPaymentToDeposit(sd._id, paidAmount, contractData.depPaymentRef || 'MIGRATION');
                    }
                } catch (coaErr) {
                    console.warn('Migration SD COA/Journal failed:', coaErr.message);
                }
            }

            contract.securityDeposit = sd._id;
            contract.securitydeposited = true;
            await contract.save();

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

            // Apply payment via centralized helper to create SD record and journal
            try {
                await ensureSecurityDepositHierarchy(contractData.building, clientId);
                // Reset amount_paid in model so applyPaymentToDeposit adds it correctly
                const amt = Number(contractData.securityDeposit);
                securityDeposit.amount_paid = 0;
                await securityDeposit.save();
                await applyPaymentToDeposit(securityDeposit._id, amt, 'MIGRATION-ST6');
            } catch (err) {
                console.warn('Migration Step 6 SD Payment failed:', err.message);
            }

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

// --- Bulk CSV Migration ---
export const bulkImportMigration = async (req, res) => {
    try {
        const { rows, dryRun = false } = req.body;
        if (!rows || !Array.isArray(rows)) {
            return res.status(400).json({ success: false, message: 'Invalid data format' });
        }

        const parseDate = (dateStr) => {
            if (!dateStr || typeof dateStr !== 'string') return null;
            // Handle DD-MM-YYYY
            if (dateStr.includes('-')) {
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                    const [d, m, y] = parts.map(Number);
                    if (y > 1000) return new Date(y, m - 1, d); // DD-MM-YYYY
                    if (d > 1000) return new Date(d, m - 1, y); // YYYY-MM-DD
                }
            }
            // Fallback for native formats or YYYY/MM/DD
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? null : d;
        };

        const results = [];
        let successCount = 0;

        // Dynamically import WalletService to avoid circular dependency issues if any
        const WalletService = (await import("../services/walletService.js")).default;

        for (const row of rows) {
            try {
                const rowResult = { ...row, errors: [], status: 'Ready' };

                // 1. Building Check
                const buildingSearch = (row.building || '').trim();
                const building = await Building.findOne({
                    $or: [
                        { name: { $regex: new RegExp(`^${buildingSearch}$`, 'i') } },
                        { _id: buildingSearch.length === 24 ? buildingSearch : undefined }
                    ].filter(x => x._id !== undefined || x.name !== undefined)
                });

                if (!building) {
                    rowResult.errors.push(`Building not found: ${buildingSearch}`);
                }

                // 2. Client Deduplication check
                const existingClient = await Client.findOne({ email: row.email });
                if (existingClient) {
                    rowResult.clientStatus = 'Existing (Will link contract)';
                } else {
                    rowResult.clientStatus = 'New (Will create)';
                }

                // Pre-validate dates
                if (!parseDate(row.startdate)) rowResult.errors.push(`Invalid start date: ${row.startdate}`);
                if (!parseDate(row.enddate)) rowResult.errors.push(`Invalid end date: ${row.enddate}`);

                if (rowResult.errors.length > 0) {
                    rowResult.status = 'Error';
                    results.push(rowResult);
                    continue;
                }

                if (dryRun) {
                    rowResult.success = true;
                    results.push(rowResult);
                    continue;
                }

                // --- ACTUAL IMPORT (dryRun: false) ---

                // 2. Client Creation/Update
                let client = existingClient;
                if (!client) {
                    client = await Client.create({
                        customerType: row.customertype || 'business',
                        email: row.email, // Primary Contact Email
                        phone: row.phone, // Primary Contact Phone
                        website: row.website,
                        industry: row.industry,
                        companyName: row.companyname,
                        legalName: row.legalname || row.companyname,
                        // Explicitly map primary contact person details
                        contactPerson: `${row.firstname || ''} ${row.lastname || ''}`.trim(),
                        primaryFirstName: row.firstname,
                        primaryLastName: row.lastname,
                        primarySalutation: row.salutation,

                        contactPersons: [{
                            salutation: row.salutation,
                            first_name: row.firstname,
                            last_name: row.lastname,
                            email: row.email,
                            phone: row.phone,
                            is_primary_contact: true,
                            enable_portal: false
                        }],

                        firstName: row.firstname,
                        lastName: row.lastname,
                        salutation: row.salutation,
                        gender: row.gender?.toLowerCase(),
                        building: building._id, // Attach Building ID
                        billingAddress: {
                            attention: row.billingattention || row.companyname,
                            address: row.billingstreet1,
                            street2: row.billingstreet2,
                            city: row.billingcity,
                            state: row.billingstate,
                            zip: row.billingzip,
                            country: row.billingcountry || 'India',
                            phone: row.billingphone || row.phone
                        },
                        shippingAddress: {
                            attention: row.shippingattention || row.companyname,
                            address: row.shippingstreet1 || row.billingstreet1,
                            street2: row.shippingstreet2 || row.billingstreet2,
                            city: row.shippingcity || row.billingcity,
                            state: row.shippingstate || row.billingstate,
                            zip: row.shippingzip || row.billingzip,
                            country: row.shippingcountry || row.billingcountry || 'India',
                            phone: row.shippingphone || row.phone
                        },
                        gstNo: row.gstno,
                        gstTreatment: row.gsttreatment || 'business_gst',
                        placeOfContact: row.placeofsupply || row.billingstate,
                        kycStatus: 'verified', // Auto-approve for migration
                        isMigrated: true,
                        source: 'migration',
                        extra_credits: 0 // Initialize
                    });
                } else {
                    // Ensure isMigrated is true for existing clients found in CSV
                    if (!client.isMigrated) {
                        client.isMigrated = true;
                        await client.save();
                    }
                }

                // 3. Contract Creation
                const startDate = parseDate(row.startdate);
                const endDate = parseDate(row.enddate);

                const contract = await Contract.create({
                    client: client._id,
                    building: building._id,
                    startDate: startDate,
                    endDate: endDate,
                    billingStartDate: startDate,
                    billingEndDate: endDate,
                    monthlyRent: Number(row['monthly subscription'] || row.monthlysubscription || row.monthlyrent || 0),
                    capacity: Number(row.capacity || 1),
                    initialCredits: Number(row['mr credits'] || row.initialcredits || 0),
                    printerCredits: Number(row.printercredits || 0),
                    legalExpenses: Number(row.legalexpenses || 1200),
                    lockInPeriodMonths: Number(row.lockinmonths || 12),
                    noticePeriodDays: Number(row.noticeperiod || 30),
                    escalation: { ratePercent: Number(row.escalationratepercentage || 0), frequencyMonths: 12 },
                    isApproved: true,
                    status: 'active',
                    source: 'migration',
                    termsAndConditions: 'Migrated via Bulk CSV',
                    fileUrl: row.signedcontract || undefined // Map signed contract URL
                });

                // Grant Initial Credits to Wallet if > 0
                if (Number(row.initialcredits) > 0) {
                    await WalletService.grantCredits({
                        clientId: client._id,
                        credits: Number(row.initialcredits),
                        valuePerCredit: Number(row.creditvalue) || 500, // Use CSV value or default
                        refType: 'contract',
                        refId: contract._id,
                        meta: { reason: 'Initial Migration Credits', contractId: contract._id }
                    });
                }

                // 4. Security Deposit (Optional)
                if (row.depositagreed) {
                    const agreedAmount = Number(row.depositagreed);
                    const paidAmount = Number(row.depositpaid || 0);
                    const paidDate = row.depositpaiddate ? parseDate(row.depositpaiddate) : new Date();

                    const sd = await SecurityDeposit.create({
                        client: client._id,
                        contract: contract._id,
                        building: building._id,
                        agreed_amount: agreedAmount,
                        amount_paid: paidAmount,
                        status: paidAmount >= agreedAmount ? 'PAID' : (agreedAmount > 0 ? 'DUE' : 'AGREED'),
                        paid_date: paidAmount > 0 ? paidDate : undefined,
                        notes: row.notes || 'Migrated via Bulk CSV'
                    });

                    contract.securityDeposit = sd._id;
                    contract.securitydeposited = true;
                    await contract.save();

                    // Create Invoice for SD
                    const invoiceNumber = await generateLocalInvoiceNumber();
                    const invoice = await Invoice.create({
                        client: client._id,
                        contract: contract._id,
                        building: building._id,
                        deposit: sd._id,
                        invoice_number: invoiceNumber,
                        type: 'security_deposit',
                        status: paidAmount >= agreedAmount ? 'paid' : (paidAmount > 0 ? 'partially_paid' : 'sent'),
                        date: paidDate,
                        due_date: startDate,
                        line_items: [{
                            description: 'Security Deposit',
                            quantity: 1,
                            unitPrice: agreedAmount,
                            amount: agreedAmount
                        }],
                        sub_total: agreedAmount,
                        total: agreedAmount,
                        balance: Math.max(0, agreedAmount - paidAmount),
                        amount_paid: paidAmount,
                        source: 'migration',
                        notes: 'Automatically created via Bulk Migration',
                        // Ensure primary contact info is used
                        billing_address: {
                            ...client.billingAddress,
                            attention: client.contactPerson || client.companyName,
                            phone: client.phone
                        }
                    });

                    // Link invoice to SD
                    sd.invoice_id = invoice._id;
                    await sd.save();

                    // Create Payment if paid
                    if (paidAmount > 0) {
                        const payment = await Payment.create({
                            client: client._id,
                            contract: contract._id,
                            amount: paidAmount,
                            paymentDate: paidDate,
                            type: row.paymenttype || 'Bank Transfer',
                            referenceNumber: row.paymentref,
                            status: 'success',
                            notes: 'Migration Security Deposit Payment',
                            invoice: invoice._id,
                            invoices: [{
                                invoice: invoice._id,
                                amount_applied: paidAmount
                            }],
                            applied_total: paidAmount
                        });
                        invoice.payment_id = payment._id;
                        if (invoice.balance <= 0) invoice.paid_at = paidDate;
                        await invoice.save();

                        // 5b. Push Payment to Zoho (if Invoice pushed successfully below)
                        // We'll queue this or handle it after invoice push
                    }

                    // 5a. Zoho Sync (Invoice & Payment)
                    try {
                        // Ensure Contact exists
                        const contactId = await findOrCreateContactFromClient(client);
                        if (contactId) {
                            client.zohoBooksContactId = contactId;
                            await client.save();

                            // Create Invoice in Zoho
                            const zohoInv = await createZohoInvoiceFromLocal(invoice, client);
                            if (zohoInv?.invoice?.invoice_id) {
                                invoice.zoho_invoice_id = zohoInv.invoice.invoice_id;
                                invoice.zoho_invoice_number = zohoInv.invoice.invoice_number;
                                invoice.zoho_status = zohoInv.invoice.status;
                                await invoice.save();

                                // Record Payment in Zoho
                                if (paidAmount > 0) {
                                    await recordZohoPayment(null, {
                                        customer_id: contactId,
                                        payment_mode: row.paymenttype || 'Bank Transfer',
                                        amount: paidAmount,
                                        date: formatDateToISO(paidDate),
                                        reference_number: row.paymentref,
                                        invoices: [{
                                            invoice_id: invoice.zoho_invoice_id,
                                            amount_applied: paidAmount
                                        }]
                                    });
                                }
                            }
                        }
                    } catch (zohoErr) {
                        console.error(`Zoho Sync failed for SD Invoice/Payment ${row.email}:`, zohoErr.message);
                    }
                } else {
                    // 5. Zoho Sync (Background) - Contact Only
                    try {
                        const contactId = await findOrCreateContactFromClient(client);
                        if (contactId) {
                            client.zohoBooksContactId = contactId;
                            await client.save();
                        }
                    } catch (zohoErr) {
                        console.error(`Zoho Sync failed for ${row.email}:`, zohoErr.message);
                    }
                }

                // 6. Document Mapping (Runs for both SD and non-SD cases)
                try {
                    const docEntities = await DocumentEntity.find({ isActive: true }).lean();
                    const kycItems = [];

                    for (const doc of docEntities) {
                        // Normalize field name for CSV matching (lowercase, no spaces/special chars)
                        const normalizedField = doc.fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
                        // Check if row has this column
                        // Check if row has this column
                        const rowKey = Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedField);

                        // Check for corresponding number field (e.g., pancard_number, gst_number)
                        const numberKey = Object.keys(row).find(k => {
                            const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                            return normalizedKey === `${normalizedField}number` || normalizedKey === `${normalizedField}no` || normalizedKey === `${normalizedField}valu`;
                        });

                        if (rowKey && row[rowKey]) {
                            const url = row[rowKey].trim();
                            if (url && (url.startsWith('http') || url.startsWith('https'))) {
                                kycItems.push({
                                    document: doc._id,
                                    fieldName: doc.fieldName,
                                    fileName: `${doc.name}.pdf`, // Generic name or extract from URL
                                    url: url,
                                    number: numberKey ? row[numberKey] : undefined,
                                    approved: true, // Auto-approve migrated docs
                                    uploadedAt: new Date()
                                });
                            }
                        }
                    }

                    if (kycItems.length > 0) {
                        await Client.findByIdAndUpdate(client._id, {
                            $push: { kycDocumentItems: { $each: kycItems } },
                            $set: { kycStatus: 'verified' }
                        });
                    }
                } catch (docErr) {
                    console.error(`Document mapping failed for ${row.email}:`, docErr.message);
                }

                // 7. Cabin Allocation
                const cabinNumber = (row['Cabin Number'] || row['cabin_number'] || row.cabinnumber || row['Cabin'] || row['cabin'])?.trim();
                let cabinAllocated = false;

                if (cabinNumber && building) {
                    try {
                        const cabin = await Cabin.findOne({
                            building: building._id,
                            number: { $regex: new RegExp(`^${cabinNumber}$`, 'i') }
                        });

                        if (cabin) {
                            if (cabin.status === 'available' || cabin.status === 'maintenance') {
                                if (!dryRun) {
                                    // Update Cabin
                                    await Cabin.findByIdAndUpdate(cabin._id, {
                                        allocatedTo: client._id,
                                        contract: contract._id,
                                        status: 'occupied',
                                        $push: {
                                            blocks: {
                                                client: client._id,
                                                contract: contract._id,
                                                fromDate: contract.startDate,
                                                toDate: contract.endDate,
                                                status: 'active',
                                                reason: 'Bulk Migration',
                                                categories: ['cabin'],
                                                notes: 'Allocated via Bulk Import'
                                            }
                                        }
                                    });

                                    // Also update contract to link back if needed, though Contract model usually links via Cabin allocation
                                    // Or if Contract has `cabins` array. Based on model view earlier, Contract doesn't seem to hold direct cabin ref array, 
                                    // but Cabin holds contract ref.
                                }
                                cabinAllocated = true;
                            } else {
                                if (dryRun) {
                                    rowResult.warnings.push(`Cabin ${cabinNumber} is currently ${cabin.status}. It will be forced allocated on import if processed.`);
                                } else {
                                    // Force allocate even if occupied? Typically beneficial for migration to override.
                                    // Let's assume yes for migration, but log it.
                                    await Cabin.findByIdAndUpdate(cabin._id, {
                                        allocatedTo: client._id,
                                        contract: contract._id,
                                        status: 'occupied',
                                        $push: {
                                            blocks: {
                                                client: client._id,
                                                contract: contract._id,
                                                fromDate: contract.startDate,
                                                toDate: contract.endDate,
                                                status: 'active',
                                                reason: 'Bulk Migration (Overwrite)',
                                                categories: ['cabin'],
                                                notes: `Allocated via Bulk Import. Previous status: ${cabin.status}`
                                            }
                                        }
                                    });
                                    cabinAllocated = true;
                                }
                            }
                        } else {
                            const msg = `Cabin ${cabinNumber} not found in building ${building.name}`;
                            if (dryRun) rowResult.errors.push(msg);
                            else console.warn(msg);
                        }
                    } catch (cabinErr) {
                        console.error(`Cabin allocation failed for ${cabinNumber}:`, cabinErr.message);
                        if (dryRun) rowResult.errors.push(`Cabin allocation error: ${cabinErr.message}`);
                    }
                }

                successCount++;
                rowResult.success = true;
                rowResult.clientId = client._id;
                rowResult.contractId = contract._id;
                if (cabinAllocated) rowResult.cabin = cabinNumber;

                results.push(rowResult);

            } catch (rowErr) {
                console.error(`Bulk import error for row ${row.email}:`, rowErr);
                results.push({ ...row, status: 'Error', errors: [(row.errors || []), rowErr.message].flat() });
            }
        }

        if (!dryRun) {
            await logCRUDActivity(req, 'CREATE', 'MigrationBulk', null, null, { count: successCount });
        }

        return res.json({
            success: true,
            dryRun,
            count: dryRun ? rows.length : successCount,
            results
        });

    } catch (error) {
        console.error('bulkImportMigration error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getBulkImportSampleCSV = async (req, res) => {
    try {
        const standardHeaders = [
            'Customer Type', 'Email', 'Phone', 'Website', 'Industry', 'Company Name', 'Legal Name',
            'Salutation', 'First Name', 'Last Name', 'Gender',
            'Billing Attention', 'Billing Street 1', 'Billing Street 2', 'Billing City', 'Billing State', 'Billing Zip', 'Billing Country', 'Billing Phone',
            'Shipping Attention', 'Shipping Street 1', 'Shipping Street 2', 'Shipping City', 'Shipping State', 'Shipping Zip', 'Shipping Country', 'Shipping Phone',
            'GST No', 'GST Treatment', 'Place of Supply',
            'Building', 'Cabin Number', 'Start Date', 'End Date', 'Monthly Subscription', 'Capacity',
            'MR Credits', 'Credit Value', 'Printer Credits', 'Legal Expenses', 'Lockin Months', 'Notice Period', 'Escalation Rate %',
            'Deposit Agreed', 'Deposit Paid', 'Deposit Paid Date', 'Payment Type', 'Payment Ref', 'Signed Contract'
        ];

        // Fetch dynamic document fields
        const docEntities = await DocumentEntity.find({ isActive: true }).select('name fieldName').lean();
        const docHeaders = [];
        docEntities.forEach(d => {
            docHeaders.push(d.fieldName); // URL column
            docHeaders.push(`${d.fieldName}_number`); // Number column
        });

        const allHeaders = [...standardHeaders, ...docHeaders];

        // Create a sample row
        const sampleRow = [
            'business', 'client@example.com', '1234567890', 'www.example.com', 'Technology', 'Example Corp', 'Example Corp Legal',
            'Mr.', 'John', 'Doe', 'male',
            'John Doe', '123 Main St', 'Suite 100', 'Mumbai', 'Maharashtra', '400001', 'India', '9876543210',
            'John Doe', '123 Main St', 'Suite 100', 'Mumbai', 'Maharashtra', '400001', 'India', '9876543210',
            '27ABCDE1234F1Z5', 'business_gst', 'Maharashtra',
            'Bldg-001', '101', '2025-01-01', '2025-12-31', '50000', '10',
            '1000', '1', '500', '2000', '6', '30', '10',
            '150000', '50000', '2024-12-30', 'Bank Transfer', 'TXN123456', 'https://example.com/contract.pdf'
        ];

        // Add placeholders for documents
        docEntities.forEach(d => {
            sampleRow.push(`https://example.com/${d.fieldName}.pdf`);
            sampleRow.push('DOC-12345');
        });
        // Generate CSV string
        const csvContent = [
            allHeaders.join(','),
            sampleRow.join(',')
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="bulk_import_sample.csv"');
        res.send(csvContent);

    } catch (error) {
        console.error('getBulkImportSampleCSV error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Bulk Financials Import (Invoices + Payments) ---
export const bulkImportInvoicesAndPayments = async (req, res) => {
    const createdLocalInvoices = []; // { _id }
    const createdLocalPayments = []; // { _id }
    const syncedZohoInvoiceIds = []; // string ID
    const syncedZohoPaymentIds = []; // string ID

    try {
        const { rows, dryRun = false } = req.body;
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid or empty rows data' });
        }

        // 1. Parse & Sort Chronologically
        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;

            const s = String(dateStr).trim();
            if (!s) return null;

            // Handle DD-MM-YYYY or DD/MM/YYYY
            const parts = s.split(/[-/.]/);
            if (parts.length === 3) {
                let day, month, year;
                if (parts[0].length === 4) {
                    // YYYY-MM-DD
                    year = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    day = parseInt(parts[2], 10);
                } else if (parts[2].length === 4) {
                    // DD-MM-YYYY
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = parseInt(parts[2], 10);
                } else if (parts[2].length === 2) {
                    // DD-MM-YY (Assume 20xx)
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = 2000 + parseInt(parts[2], 10);
                }

                if (year && !isNaN(month) && day) {
                    const d = new Date(year, month, day);
                    return isNaN(d.getTime()) ? null : d;
                }
            }

            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;
        };

        const sortedRows = [...rows].map((row, index) => ({
            ...row,
            parsedDate: parseDate(row.issue_date),
            originalIndex: index
        })).sort((a, b) => {
            const tA = a.parsedDate ? a.parsedDate.getTime() : 0;
            const tB = b.parsedDate ? b.parsedDate.getTime() : 0;
            return tA - tB;
        });

        // DRY RUN LOGIC
        if (dryRun) {
            const results = [];
            for (const row of sortedRows) {
                const errors = [];
                const companyName = (row.company_name || '').trim();
                let clientName = '';

                // Validate Client
                if (!companyName) {
                    errors.push('Company Name is required');
                } else {
                    const client = await Client.findOne({
                        companyName: { $regex: new RegExp(`^${companyName}$`, 'i') }
                    }).select('companyName firstName lastName');
                    if (!client) {
                        errors.push(`Client with company name '${companyName}' not found`);
                    } else {
                        clientName = client.companyName || `${client.firstName} ${client.lastName}`.trim();
                    }
                }

                // Validate Dates
                if (!row.parsedDate) errors.push('Invalid Issue Date');
                if (row.due_date && !parseDate(row.due_date)) errors.push('Invalid Due Date');



                results.push({
                    ...row,
                    clientName,
                    invoice_number: row.invoice_number || 'AUTO',
                    status: errors.length > 0 ? 'Error' : 'Valid',
                    errors
                });
            }

            // Restore original order for UI consistency if needed, or keep sorted
            // Usually UI expects rows in order of CSV, but sorted is better for display
            return res.json({
                success: true,
                dryRun: true,
                count: results.length,
                results
            });
        }


        // 2. Process Rows (Already sorted chronologically)
        console.log(`Starting bulk import of ${sortedRows.length} invoices...`);

        // 3. Process Rows
        for (const row of sortedRows) {
            // Validate Client
            const companyName = (row.company_name || '').trim();
            if (!companyName) throw new Error(`Row ${row.originalIndex + 1}: Company Name is required`);

            const client = await Client.findOne({
                companyName: { $regex: new RegExp(`^${companyName}$`, 'i') }
            });
            if (!client) throw new Error(`Row ${row.originalIndex + 1}: Client with company name '${companyName}' not found`);

            // Validate Building (Optional but good for data integrity)
            let buildingId = client.building;
            if (row.building_name) {
                const b = await Building.findOne({ name: { $regex: new RegExp(`^${row.building_name}$`, 'i') } });
                if (b) buildingId = b._id;
            }

            // Create Invoice
            const invoiceData = {
                client: client._id,
                building: buildingId,
                invoice_number: row.invoice_number || await generateLocalInvoiceNumber(),
                date: row.parsedDate || new Date(),
                due_date: parseDate(row.due_date) || row.parsedDate || new Date(),
                billing_period: {
                    start: parseDate(row.billing_start) || row.parsedDate || new Date(),
                    end: parseDate(row.billing_end) || row.parsedDate || new Date()
                },
                line_items: [{
                    description: row.description || 'Services',
                    quantity: 1,
                    unitPrice: Number(row.unit_price || 0),
                    amount: Number(row.unit_price || 0),
                    tax_percentage: Number(row.tax_percentage || 0)
                }],
                sub_total: Number(row.unit_price || 0),
                total: Number(row.unit_price || 0), // Assuming tax inclusive or simple logic for migration
                balance: Number(row.unit_price || 0),
                status: 'draft', // Will update to paid/sent below
                notes: row.notes || 'Bulk Import',
                source: 'migration'
            };

            // Calculate Tax if exclusive (simple logic)
            if (Number(row.tax_percentage) > 0) {
                const taxAmount = (invoiceData.sub_total * Number(row.tax_percentage)) / 100;
                invoiceData.tax_total = taxAmount;
                invoiceData.total = invoiceData.sub_total + taxAmount;
                invoiceData.balance = invoiceData.total;
            }

            const invoice = await Invoice.create(invoiceData);
            createdLocalInvoices.push(invoice._id);

            // Push Invoice to Zoho
            // Ensure Contact
            if (!client.zohoBooksContactId) {
                const contactId = await findOrCreateContactFromClient(client);
                if (contactId) {
                    client.zohoBooksContactId = contactId;
                    await client.save();
                } else {
                    throw new Error(`Row ${row.originalIndex + 1}: Failed to create Zoho Contact`);
                }
            }

            let zohoInv = null;
            try {
                zohoInv = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject());
            } catch (zErr) {
                throw new Error(`Row ${row.originalIndex + 1}: Zoho Push Failed - ${zErr.message}`);
            }

            if (!zohoInv?.invoice?.invoice_id) {
                throw new Error(`Row ${row.originalIndex + 1}: Failed to push invoice to Zoho (No ID returned)`);
            }

            invoice.zoho_invoice_id = zohoInv.invoice.invoice_id;
            invoice.zoho_invoice_number = zohoInv.invoice.invoice_number;
            invoice.zoho_status = zohoInv.invoice.status;
            invoice.source = 'zoho';
            await invoice.save();

            syncedZohoInvoiceIds.push(invoice.zoho_invoice_id);

            // Process Payment (if any)
            const paidAmount = Number(row.amount_paid || 0);
            if (paidAmount > 0) {
                const paymentDate = parseDate(row.payment_date) || new Date();
                const payment = await Payment.create({
                    client: client._id,
                    invoice: invoice._id,
                    amount: paidAmount,
                    paymentDate: paymentDate,
                    type: row.payment_mode || 'Bank Transfer',
                    referenceNumber: row.payment_ref,
                    status: 'success',
                    notes: `Payment for ${invoice.invoice_number}`,
                    source: 'migration',
                    invoices: [{
                        invoice: invoice._id,
                        amount_applied: paidAmount
                    }],
                    applied_total: paidAmount
                });
                createdLocalPayments.push(payment._id);

                // Update Invoice Status
                invoice.amount_paid += paidAmount;
                invoice.balance = Math.max(0, invoice.total - invoice.amount_paid);
                if (invoice.balance <= 0) {
                    invoice.status = 'paid';
                    invoice.paid_at = paymentDate;
                } else {
                    invoice.status = 'partially_paid';
                }
                await invoice.save();

                // Push Payment to Zoho
                try {
                    const zPayment = await recordZohoPayment(null, {
                        customer_id: client.zohoBooksContactId,
                        payment_mode: row.payment_mode || 'Bank Transfer',
                        amount: paidAmount,
                        date: paymentDate.toISOString().split('T')[0],
                        reference_number: row.payment_ref,
                        invoices: [{
                            invoice_id: invoice.zoho_invoice_id,
                            amount_applied: paidAmount
                        }]
                    });

                    if (zPayment?.payment?.payment_id) {
                        payment.zoho_payment_id = zPayment.payment.payment_id;
                        payment.payment_number = zPayment.payment.payment_number;
                        payment.source = 'zoho_books';
                        await payment.save();
                        syncedZohoPaymentIds.push(payment.zoho_payment_id);
                    } else {
                        throw new Error('Zoho Payment creation failed');
                    }
                } catch (paymentErr) {
                    throw new Error(`Row ${row.originalIndex + 1}: Payment Sync Failed - ${paymentErr.message}`);
                }
            } else {
                // If no payment, mark as sent so it's active in Zoho
                invoice.status = 'sent';
                // Optionally mark sent in Zoho? 
                // await markZohoInvoiceAsSent(invoice.zoho_invoice_id); 
                await invoice.save();
            }
        }

        return res.json({
            success: true,
            message: 'Bulk Import Successful',
            stats: {
                invoices: createdLocalInvoices.length,
                payments: createdLocalPayments.length
            }
        });

    } catch (error) {
        console.error('bulkImportInvoicesAndPayments Failed. Initiating Rollback...', error);

        // --- ROLLBACK ---
        const rollbackErrors = [];

        // 1. Delete Zoho Payments
        for (const pId of syncedZohoPaymentIds) {
            try { await deleteZohoPayment(pId); } catch (e) { rollbackErrors.push(`Zoho Payment ${pId}: ${e.message}`); }
        }

        // 2. Delete Zoho Invoices
        for (const invId of syncedZohoInvoiceIds) {
            try { await deleteZohoInvoice(invId); } catch (e) { rollbackErrors.push(`Zoho Invoice ${invId}: ${e.message}`); }
        }

        // 3. Delete Local Payments
        if (createdLocalPayments.length > 0) {
            await Payment.deleteMany({ _id: { $in: createdLocalPayments } });
        }

        // 4. Delete Local Invoices
        if (createdLocalInvoices.length > 0) {
            await Invoice.deleteMany({ _id: { $in: createdLocalInvoices } });
        }

        return res.status(500).json({
            success: false,
            message: `Import Failed: ${error.message}. Rollback performed.`,
            rollbackErrors: rollbackErrors.length > 0 ? rollbackErrors : undefined
        });
    }
};

export const getBulkFinancialsSampleCSV = async (req, res) => {
    try {
        const headers = [
            'company_name', 'building_name', 'invoice_number', 'issue_date', 'due_date',
            'description', 'unit_price', 'tax_percentage',
            'amount_paid', 'payment_date', 'payment_mode', 'payment_ref',
            'billing_start', 'billing_end', 'notes'
        ];

        const sampleRow = [
            'Example Corp', 'Building A', '', '2025-01-01', '2025-01-15',
            'Office Rent for Jan', '50000', '18',
            '59000', '2025-01-02', 'Bank Transfer', 'REF123456',
            '2025-01-01', '2025-01-31', 'Migrated Invoice'
        ];

        const csvContent = [headers.join(','), sampleRow.join(',')].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="bulk_financials_sample.csv"');
        res.send(csvContent);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Bulk Member Import ---

export const getBulkMembersSampleCSV = (req, res) => {
    const csvContent = `firstName,lastName,email,phone,isBossUser,rfid,company_name\nJohn,Doe,john.doe@example.com,9876543210,false,12345678,Acme Corp\nJane,Smith,jane.smith@example.com,9876543211,true,87654321,Globex Corp`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk_members_sample.csv"');
    res.send(csvContent);
};

export const bulkImportMembers = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const dryRun = req.body.dryRun === 'true';
        const rows = [];
        const csvString = req.file.buffer.toString('utf8');

        // Basic CSV Parsing
        const lines = csvString.split(/\r?\n/);
        const headers = lines[0].split(',').map(h => h.trim());

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Handle quoted values if necessary, but simple split for now
            // Better: use library but manual split often sufficient for strict templates
            // Ensuring simple split works for now assuming no commas in values
            const values = line.split(',');
            if (values.length < headers.length) continue;

            const row = {};
            headers.forEach((h, index) => {
                row[h] = values[index]?.trim();
            });
            row.originalIndex = i;
            rows.push(row);
        }

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        // Pre-fetch Roles Map
        const roles = await Role.find({}).lean();
        const roleMap = new Map(roles.map(r => [r.roleName.toLowerCase(), r]));

        for (const row of rows) {
            const errors = [];
            const { firstName, lastName, email, phone, isBossUser, rfid, company_name } = row;

            // 1. Basic Validation
            if (!firstName) errors.push('First Name required');
            if (!email) errors.push('Email required');
            if (!company_name) errors.push('Company Name required');

            // 2. Validate Role
            let roleId = null;
            const targetRoleName = (isBossUser === 'true' || isBossUser === '1') ? 'client' : 'member';
            const r = roleMap.get(targetRoleName);
            if (!r) {
                errors.push(`Role '${targetRoleName}' not found in system`);
            } else {
                roleId = r._id;
            }

            // 3. Validate Client & Contracts/Cabins
            let client = null;
            let contract = null;
            let cabin = null;

            if (company_name) {
                // Find client by company name (case-insensitive)
                client = await Client.findOne({
                    companyName: { $regex: new RegExp(`^${company_name}$`, 'i') }
                }).lean();

                if (!client) {
                    errors.push(`Client '${company_name}' not found`);
                } else {
                    // Check for Active Contract
                    contract = await Contract.findOne({
                        client: client._id,
                        status: 'active'
                    }).sort({ createdAt: -1 }).lean();

                    if (!contract) {
                        errors.push(`Client '${client.companyName}' has no active contract`);
                    }

                    // Check for Occupied Cabin (Allocation)
                    cabin = await Cabin.findOne({
                        allocatedTo: client._id,
                        status: { $ne: 'available' } // Should be 'occupied' or similar
                    }).populate('building').lean();

                    if (!cabin) {
                        errors.push(`Client '${client.companyName}' has no allocated cabin`);
                    }
                }
            }

            // 4. Duplicate Check (Email)
            if (email) {
                const existingMember = await Member.findOne({ email }).lean();
                if (existingMember) errors.push(`Member with email '${email}' already exists`);

                const existingUser = await User.findOne({ email }).lean();
                if (existingUser) errors.push(`User with email '${email}' already exists`);
            }

            if (errors.length > 0) {
                errorCount++;
                results.push({ ...row, status: 'Error', errors });
                continue;
            }

            // --- EXECUTION (If not Dry Run) ---
            if (!dryRun) {
                try {
                    // A. Create User
                    const defaultPassword = "123456";
                    const userData = {
                        name: `${firstName} ${lastName || ''}`.trim(),
                        email: email,
                        phone: phone || undefined,
                        password: defaultPassword,
                        role: roleId,
                        isEmailVerified: true // Assume verified for bulk import
                    };
                    const createdUser = await User.create(userData);

                    // B. Create Member
                    const memberData = {
                        firstName,
                        lastName,
                        email,
                        phone,
                        companyName: client.companyName,
                        role: roleId,
                        status: 'active',
                        client: client._id,
                        user: createdUser._id,
                        // Could link desk if cabin has free desks, but skipping for bulk logic complexity
                    };
                    const createdMember = await Member.create(memberData);

                    // C. Matrix Provisioning
                    let matrixUserId = null;
                    if (phone) {
                        let p = String(phone).replace(/\D/g, "");
                        p = p.replace(/^0+/, "");
                        const last10 = p.length > 10 ? p.slice(-10) : p;
                        if (last10.length === 10) matrixUserId = `91${last10}`;
                    }

                    if (!matrixUserId) {
                        const random6 = Math.floor(100000 + Math.random() * 900000);
                        matrixUserId = `MEM${random6}`;
                    }

                    try {
                        // Create Matrix User
                        await matrixApi.createUser({
                            id: matrixUserId,
                            name: `${firstName} ${lastName || ''}`.trim(),
                            email,
                            phone,
                            status: "active",
                            // Use contract end date if available for validity?
                            accessValidityDate: contract?.endDate ? new Date(contract.endDate) : undefined
                        });

                        // Upsert Local MatrixUser
                        const mu = await MatrixUser.findOneAndUpdate(
                            { externalUserId: matrixUserId },
                            {
                                $setOnInsert: {
                                    externalUserId: matrixUserId,
                                    name: `${firstName} ${lastName || ''}`.trim(),
                                    email,
                                    phone,
                                    status: 'active'
                                },
                                $set: {
                                    buildingId: cabin?.building?._id,
                                    clientId: client._id,
                                    memberId: createdMember._id,
                                    isEnrolled: !!rfid
                                }
                            },
                            { upsert: true, new: true }
                        );

                        // Link to Member
                        await Member.findByIdAndUpdate(createdMember._id, {
                            $set: { matrixUser: mu._id, matrixExternalUserId: matrixUserId }
                        });

                        // RFID Assignment
                        if (rfid) {
                            try {
                                const enrollRes = await matrixApi.setCardCredential({
                                    externalUserId: matrixUserId,
                                    data: rfid
                                });
                                if (enrollRes?.ok) {
                                    await MatrixUser.findByIdAndUpdate(mu._id, { isCardCredentialVerified: true });
                                } else {
                                    console.warn(`RFID assignment failed for ${email}: ${enrollRes?.data?.message}`);
                                }
                            } catch (e) {
                                console.warn(`RFID assignment error for ${email}: ${e.message}`);
                            }
                        }

                        // Device Assignment (Based on Cabin -> AccessPoint)
                        if (cabin) {
                            // Find Access Point linked to this cabin/client/building
                            // Logic mimics createMember: find devices in default building policy OR cabin-specific AP
                            const buildingIdForJobs = cabin.building?._id || client.building;

                            if (buildingIdForJobs) {
                                // Find valid Access Policy
                                const policyDoc = await AccessPolicy.findOne({
                                    buildingId: buildingIdForJobs,
                                    isDefaultForBuilding: true,
                                    status: "active"
                                }).select('accessPointIds').lean();

                                if (policyDoc?.accessPointIds?.length) {
                                    const aps = await AccessPoint.find({ _id: { $in: policyDoc.accessPointIds } })
                                        .select('deviceBindings')
                                        .lean();

                                    const deviceIdsToAssign = new Set();
                                    for (const ap of aps) {
                                        if (ap.deviceBindings) {
                                            for (const b of ap.deviceBindings) {
                                                if (b.vendor === 'MATRIX_COSEC' && b.deviceId) {
                                                    // Need to resolve MatrixDevice to get actual device_id (int/string)
                                                    const md = await MatrixDevice.findById(b.deviceId).select('device_id').lean();
                                                    if (md?.device_id) deviceIdsToAssign.add(md.device_id);
                                                }
                                            }
                                        }
                                    }

                                    for (const devId of deviceIdsToAssign) {
                                        try {
                                            await matrixApi.assignUserToDevice({ device_id: devId, externalUserId: matrixUserId });
                                        } catch (e) {
                                            console.warn(`Failed to assign device ${devId} to ${matrixUserId}: ${e.message}`);
                                        }
                                    }

                                    if (deviceIdsToAssign.size > 0) {
                                        await MatrixUser.findByIdAndUpdate(mu._id, { isDeviceAssigned: true });
                                    }
                                }
                            }
                        }

                    } catch (matrixErr) {
                        console.error(`Matrix provisioning failed for ${email}:`, matrixErr);
                        // Don't fail the whole import, just log
                    }

                    // D. Bhaifi Provisioning
                    try {
                        const bhaifiDoc = await ensureBhaifiForMember({
                            memberId: createdMember._id,
                            contractId: contract._id
                        });

                        if (bhaifiDoc) {
                            await Member.findByIdAndUpdate(createdMember._id, {
                                $set: { bhaifiUser: bhaifiDoc._id, bhaifiUserName: bhaifiDoc.userName }
                            });
                        }
                    } catch (bhaifiErr) {
                        console.error(`Bhaifi provisioning failed for ${email}:`, bhaifiErr);
                    }

                    successCount++;
                    results.push({ ...row, status: 'Imported', errors: [] });
                } catch (err) {
                    errorCount++;
                    results.push({ ...row, status: 'Error', errors: [err.message] });
                }
            } else {
                // Dry Run Success
                results.push({ ...row, status: 'Valid', errors: [] });
            }
        } // End Loop

        res.json({
            success: true,
            dryRun,
            count: results.length,
            successCount: dryRun ? 0 : successCount,
            errorCount: dryRun ? errorCount : errorCount, // In dry run, all 'valid' are potential successes
            results
        });

    } catch (error) {
        console.error('Bulk Member Import Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const listPendingMigrations = async (req, res) => {
    try {
        const clients = await Client.find({ isMigrated: true }).sort({ updatedAt: -1 });

        const results = await Promise.all(clients.map(async (client) => {
            const [contract, membersCount, invoices] = await Promise.all([
                Contract.findOne({ client: client._id }).sort({ createdAt: -1 }),
                Member.countDocuments({ client: client._id }),
                Invoice.find({ client: client._id })
            ]);

            const cabin = contract ? await Cabin.findOne({ contract: contract._id }) : null;

            // Determine current step based on data presence
            let currentStep = 2; // Step 1 is done
            if (client.kycStatus === 'verified' || client.kycDocumentItems?.length > 0) currentStep = 3;
            if (contract) currentStep = 4;
            if (cabin) currentStep = 5;
            if (invoices.length > 0) currentStep = 6;
            if (membersCount > 1) currentStep = 7;

            return {
                _id: client._id,
                companyName: client.companyName,
                email: client.email,
                firstName: client.primaryFirstName,
                lastName: client.primaryLastName,
                currentStep,
                updatedAt: client.updatedAt
            };
        }));

        // Filter out those who are at the last step (Review) if you want only "Pending"
        const pending = results.filter(r => r.currentStep < 7);

        return res.json({ success: true, count: pending.length, clients: pending });
    } catch (error) {
        console.error('listPendingMigrations error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- Bulk Contract Import ---

export const getBulkContractsSampleCSV = async (req, res) => {
    try {
        const headers = [
            'Client Name', 'Building', 'Cabin Number', 'Start Date', 'End Date',
            'Monthly Subscription', 'Capacity', 'MR Credits', 'Printer Credits',
            'Legal Expenses', 'Lockin Months', 'Notice Period', 'Escalation Rate %',
            'Deposit Agreed', 'Deposit Paid', 'Deposit Paid Date', 'Payment Type', 'Payment Ref',
            'Signed Contract', 'GST Number', 'Addon Names', 'Addon Amounts', 'Addon Types', 'Addon Start Dates', 'Addon End Dates'
        ];

        const sampleRow = [
            'Acme Corp', 'Bldg-001', '101', '2025-01-01', '2025-12-31',
            '50000', '10', '1000', '500', '2000', '12', '30', '0',
            '150000', '150000', '2024-12-30', 'Bank Transfer', 'TXN789012', 'https://example.com/contract.pdf', '22AAAAA0000A1Z5',
            'High Speed Internet / Tea & Coffee', '2000 / 500', 'monthly / monthly', '2025-01-01 / 2025-01-01', '2025-12-31 / 2025-03-31'
        ];

        const csvContent = [headers.join(','), sampleRow.join(',')].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="bulk_contracts_sample.csv"');
        res.send(csvContent);
    } catch (error) {
        console.error('getBulkContractsSampleCSV error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const bulkImportContracts = async (req, res) => {
    try {
        const { rows, dryRun = false } = req.body;
        if (!rows || !Array.isArray(rows)) {
            return res.status(400).json({ success: false, message: 'Invalid data format' });
        }

        const formatDateToISO = (date) => {
            if (!date) return undefined;
            const d = new Date(date);
            if (isNaN(d.getTime())) return undefined;
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        const parseDate = (dateStr) => {
            if (!dateStr || typeof dateStr !== 'string') return null;

            const s = dateStr.trim();
            if (!s) return null;

            // Handle DD-MM-YYYY or DD-MM-YY
            const parts = s.split(/[-/.]/);
            if (parts.length === 3) {
                let day, month, year;
                if (parts[0].length === 4) {
                    // YYYY-MM-DD
                    year = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    day = parseInt(parts[2], 10);
                } else if (parts[2].length === 4) {
                    // DD-MM-YYYY
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = parseInt(parts[2], 10);
                } else if (parts[2].length === 2) {
                    // DD-MM-YY (Assume 20xx)
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = 2000 + parseInt(parts[2], 10);
                }

                if (year && !isNaN(month) && day) {
                    const d = new Date(year, month, day);
                    return isNaN(d.getTime()) ? null : d;
                }
            }

            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;
        };

        const results = [];
        let successCount = 0;
        const WalletService = (await import("../services/walletService.js")).default;

        for (const row of rows) {
            try {
                const rowResult = { ...row, errors: [], status: 'Ready' };
                const clientNameInput = (row['Client Name'] || row.clientName || row.client_name || '').trim();

                // 1. Client Check (By Name)
                if (!clientNameInput) {
                    rowResult.errors.push(`Client Name is required`);
                    rowResult.status = 'Error';
                    results.push(rowResult);
                    continue;
                }

                const client = await Client.findOne({
                    companyName: { $regex: new RegExp(`^${clientNameInput}$`, 'i') }
                });

                if (!client) {
                    rowResult.errors.push(`Client not found with name: ${clientNameInput}`);
                    rowResult.status = 'Error';
                    results.push(rowResult);
                    continue;
                }

                rowResult.clientName = client.companyName || `${client.firstName} ${client.lastName}`.trim();

                // 2. Building Check
                const buildingSearch = (row.Building || row.building || '').trim();
                const building = await Building.findOne({
                    $or: [
                        { name: { $regex: new RegExp(`^${buildingSearch}$`, 'i') } },
                        { _id: buildingSearch.length === 24 ? buildingSearch : undefined }
                    ].filter(x => x._id !== undefined || x.name !== undefined)
                });
                if (!building) {
                    rowResult.errors.push(`Building not found: ${buildingSearch}`);
                }

                // 3. Date Validation
                const startDate = parseDate(row['Start Date'] || row.startdate || row.startDate);
                const endDate = parseDate(row['End Date'] || row.enddate || row.endDate);
                if (!startDate) rowResult.errors.push(`Invalid start date: ${row['Start Date'] || row.startdate || row.startDate}`);
                if (!endDate) rowResult.errors.push(`Invalid end date: ${row['End Date'] || row.enddate || row.endDate}`);

                if (rowResult.errors.length > 0) {
                    rowResult.status = 'Error';
                    results.push(rowResult);
                    continue;
                }

                // --- GST Parsing ---
                const gstInput = (row['GST Number'] || row.gstnumber || row.gstNumber || row.gst_number);
                let parsedGstNo, parsedGstTreatment, parsedPlaceOfSupply;

                if (gstInput && typeof gstInput === 'string' && gstInput.trim()) {
                    parsedGstNo = gstInput.trim();
                    parsedGstTreatment = 'business_gst';

                    const stateCodeMap = {
                        "35": "AN", "28": "AP", "12": "AR", "18": "AS", "10": "BR", "04": "CH", "22": "CT",
                        "26": "DN", "25": "DN", "07": "DL", "30": "GA", "24": "GJ", "06": "HR", "02": "HP",
                        "01": "JK", "20": "JH", "29": "KA", "32": "KL", "37": "LA", "31": "LD", "23": "MP",
                        "27": "MH", "14": "MN", "17": "ML", "15": "MZ", "13": "NL", "21": "OR", "34": "PY",
                        "03": "PB", "08": "RJ", "11": "SK", "33": "TN", "36": "TS", "16": "TR", "09": "UP",
                        "05": "UK", "19": "WB"
                    };
                    const statePrefix = parsedGstNo.substring(0, 2);
                    parsedPlaceOfSupply = stateCodeMap[statePrefix] || statePrefix;
                }

                // --- Add-ons Parsing ---
                const addonNamesRaw = String(row['Addon Names'] || row.addonnames || row.addonNames || '');
                const addonAmountsRaw = String(row['Addon Amounts'] || row.addonamounts || row.addonAmounts || '');
                const addonTypesRaw = String(row['Addon Types'] || row.addontypes || row.addonTypes || '');
                const addonStartDatesRaw = String(row['Addon Start Dates'] || row.addonstartdates || row.addonStartDates || '');
                const addonEndDatesRaw = String(row['Addon End Dates'] || row.addonenddates || row.addonEndDates || '');

                const splitAddonNames = addonNamesRaw ? addonNamesRaw.split('/').map(v => v.trim()) : [];
                const splitAddonAmounts = addonAmountsRaw ? addonAmountsRaw.split('/').map(v => Number(v.trim())) : [];
                const splitAddonTypes = addonTypesRaw ? addonTypesRaw.split('/').map(v => v.trim().toLowerCase()) : [];
                const splitAddonStartDates = addonStartDatesRaw ? addonStartDatesRaw.split('/').map(v => v.trim()) : [];
                const splitAddonEndDates = addonEndDatesRaw ? addonEndDatesRaw.split('/').map(v => v.trim()) : [];

                const contractAddOns = [];
                const addonMasterList = await AddOn.find({ isActive: true }).lean();

                for (let i = 0; i < splitAddonNames.length; i++) {
                    const name = splitAddonNames[i];
                    if (!name) continue;

                    const amount = splitAddonAmounts[i] || 0;
                    const type = (splitAddonTypes[i] === 'one-time' || splitAddonTypes[i] === 'one_time') ? 'one-time' : 'monthly';
                    const sDate = parseDate(splitAddonStartDates[i]);
                    const eDate = parseDate(splitAddonEndDates[i]);

                    const masterAddon = addonMasterList.find(a => a.name.toLowerCase() === name.toLowerCase());

                    contractAddOns.push({
                        addonId: masterAddon?._id || null,
                        description: name,
                        amount: amount,
                        billingCycle: type,
                        startDate: sDate || undefined,
                        endDate: eDate || undefined,
                        status: 'active',
                        addedAt: new Date(),
                        addedBy: req.user?._id
                    });
                }

                // --- ACTUAL IMPORT SIMULATION ---
                let contractIdForSim = "SIMULATED_ID";
                let contract;
                if (!dryRun) {
                    contract = await Contract.create({
                        client: client._id,
                        building: building._id,
                        startDate: startDate,
                        endDate: endDate,
                        billingStartDate: startDate,
                        billingEndDate: endDate,
                        monthlyRent: Number(row['Monthly Subscription'] || row.monthlysubscription || row.monthlySubscription || 0),
                        capacity: Number(row.Capacity || row.capacity || 1),
                        initialCredits: Number(row['MR Credits'] || row.mrcredits || row.initialCredits || 0),
                        printerCredits: Number(row['Printer Credits'] || row.printercredits || row.printerCredits || 0),
                        legalExpenses: Number(row['Legal Expenses'] || row.legalexpenses || row.legalExpenses || 1200),
                        lockInPeriodMonths: Number(row['Lockin Months'] || row.lockinmonths || row.lockInPeriodMonths || 12),
                        noticePeriodDays: Number(row['Notice Period'] || row.noticeperiod || row.noticePeriodDays || 30),
                        escalation: { ratePercent: Number(row['Escalation Rate %'] || row.escalationratepercentage || 0), frequencyMonths: 12 },
                        isApproved: true,
                        status: 'active',
                        source: 'migration',
                        termsAndConditions: 'Bulk Contract Migration',
                        fileUrl: row['Signed Contract'] || row.signedcontract || row.fileUrl || undefined,
                        gst_no: parsedGstNo,
                        gst_treatment: parsedGstTreatment,
                        place_of_supply: parsedPlaceOfSupply,
                        iskycuploaded: true,
                        iskycapproved: true,
                        adminapproved: true,
                        legalteamapproved: true,
                        clientapproved: true,
                        financeapproved: true,
                        securitydeposited: true,
                        iscontractsentforsignature: true,
                        iscontractstamppaperupload: true,
                        isclientsigned: true,
                        isfinalapproval: true,
                        salesSeniorApproved: true,
                        addOns: contractAddOns
                    });
                    contractIdForSim = contract._id;
                }

                // Grant Credits
                const credits = Number(row['MR Credits'] || row.mrcredits || row.initialCredits || 0);
                if (credits > 0 && !dryRun) {
                    await WalletService.grantCredits({
                        clientId: client._id,
                        credits: credits,
                        valuePerCredit: 500,
                        refType: 'contract',
                        refId: contractIdForSim,
                        meta: { reason: 'Bulk Contract Migration Credits' }
                    });
                }

                // Sync Printer Credits to Wallet
                const printerCredits = Number(row['Printer Credits'] || row.printercredits || row.printerCredits || 0);
                if (printerCredits > 0 && !dryRun) {
                    try {
                        await ClientCreditWallet.findOneAndUpdate(
                            { client: client._id },
                            { $inc: { printerBalance: printerCredits } },
                            { new: true, upsert: true }
                        );
                    } catch (walletErr) {
                        console.warn(`Row processing: failed to sync printer credits to wallet:`, walletErr.message);
                    }
                }

                // Security Deposit logic
                const depositAgreed = Number(row['Deposit Agreed'] || row.depositagreed || row.depositAgreed || 0);
                let totalPaidToApply = 0;
                let paymentsToCreate = [];
                if (depositAgreed > 0) {
                    const rawPaid = String(row['Deposit Paid'] || row.depositpaid || row.depositPaid || '0');
                    const rawDates = String(row['Deposit Paid Date'] || row.depositpaiddate || row.depositPaidDate || '');
                    const rawTypes = String(row['Payment Type'] || row.paymenttype || row.paymentType || 'Bank Transfer');
                    const rawRefs = String(row['Payment Ref'] || row.paymentref || row.paymentRef || '');

                    const splitPaid = rawPaid.includes('/') ? rawPaid.split('/').map(v => Number(v.trim())) : [Number(rawPaid)];
                    const splitDates = rawDates.includes('/') ? rawDates.split('/') : [rawDates];
                    const splitTypes = rawTypes.includes('/') ? rawTypes.split('/') : [rawTypes];
                    const splitRefs = rawRefs.includes('/') ? rawRefs.split('/') : [rawRefs];

                    const installmentCount = Math.max(splitPaid.length, splitDates.length, splitTypes.length, splitRefs.length);

                    for (let i = 0; i < installmentCount; i++) {
                        let pAmount = splitPaid[i] !== undefined ? splitPaid[i] : (i === 0 ? Number(rawPaid) : 0);
                        if (totalPaidToApply + pAmount > depositAgreed) {
                            pAmount = Math.max(0, depositAgreed - totalPaidToApply);
                        }
                        if (pAmount <= 0) continue;
                        totalPaidToApply += pAmount;

                        paymentsToCreate.push({
                            amount: pAmount,
                            date: parseDate(splitDates[i] || splitDates[splitDates.length - 1]) || new Date(),
                            type: mapPaymentType(splitTypes[i] || splitTypes[0] || 'Bank Transfer'),
                            ref: (splitRefs[i] || splitRefs[0] || '').trim()
                        });
                    }

                    if (!dryRun) {
                        const sd = await SecurityDeposit.create({
                            client: client._id,
                            contract: contractIdForSim,
                            building: building._id,
                            agreed_amount: depositAgreed,
                            amount_paid: totalPaidToApply,
                            status: totalPaidToApply >= depositAgreed ? 'PAID' : (totalPaidToApply > 0 ? 'PARTIAL' : 'DUE'),
                            paid_date: paymentsToCreate.length > 0 ? paymentsToCreate[paymentsToCreate.length - 1].date : undefined,
                            notes: 'Bulk Contract Migration'
                        });

                        const invoiceNumber = await generateLocalInvoiceNumber();
                        const invoice = await Invoice.create({
                            client: client._id,
                            contract: contractIdForSim,
                            building: building._id,
                            deposit: sd._id,
                            invoice_number: invoiceNumber,
                            type: 'security_deposit',
                            status: totalPaidToApply >= depositAgreed ? 'paid' : (totalPaidToApply > 0 ? 'partially_paid' : 'sent'),
                            date: paymentsToCreate.length > 0 ? paymentsToCreate[0].date : new Date(),
                            due_date: startDate,
                            line_items: [{ description: 'Security Deposit', quantity: 1, unitPrice: depositAgreed, amount: depositAgreed }],
                            sub_total: depositAgreed,
                            total: depositAgreed,
                            balance: Math.max(0, depositAgreed - totalPaidToApply),
                            amount_paid: totalPaidToApply,
                            source: 'migration',
                            billing_address: { ...client.billingAddress, attention: client.contactPerson || client.companyName }
                        });
                        sd.invoice_id = invoice._id;
                        await sd.save();

                        client.securityDeposit = sd._id;
                        client.isSecurityPaid = totalPaidToApply >= depositAgreed;
                        if (!client.building) client.building = building._id;
                        client.isMigrated = true;
                        client.isClientApproved = true;
                        client.companyDetailsComplete = true;
                        client.kycStatus = 'verified';
                        client.membershipStatus = true;

                        if (parsedGstNo) {
                            client.gstNumber = parsedGstNo;
                            client.gstNo = parsedGstNo;
                            client.taxRegNo = parsedGstNo;
                            client.gstTreatment = parsedGstTreatment;
                            client.isTaxable = true;

                            if (parsedPlaceOfSupply) {
                                if (!client.taxInfoList) client.taxInfoList = [];
                                const existing = client.taxInfoList.find(t => t.tax_registration_no === parsedGstNo);
                                if (existing) {
                                    existing.place_of_supply = parsedPlaceOfSupply;
                                    existing.is_primary = true;
                                } else {
                                    client.taxInfoList.push({
                                        tax_registration_no: parsedGstNo,
                                        place_of_supply: parsedPlaceOfSupply,
                                        is_primary: true
                                    });
                                }
                            }
                        }
                        await client.save();

                        contract.securityDeposit = sd._id;
                        await contract.save();

                        for (const pData of paymentsToCreate) {
                            try {
                                const payment = await Payment.create({
                                    client: client._id,
                                    contract: contractIdForSim,
                                    amount: pData.amount,
                                    paymentDate: pData.date,
                                    type: pData.type,
                                    referenceNumber: pData.ref,
                                    status: 'success',
                                    invoice: invoice._id,
                                    invoices: [{ invoice: invoice._id, amount_applied: pData.amount }],
                                    applied_total: pData.amount,
                                    source: 'migration'
                                });
                                invoice.payment_id = payment._id;
                            } catch (paymentErr) {
                                console.error(`Failed to create payment for ${client.companyName}:`, paymentErr.message);
                                results[results.length - 1].errors.push(`Payment failed: ${paymentErr.message}`);
                            }
                        }
                        await invoice.save();
                    }
                }

                // Cabin Allocation simulation
                const cabinNumber = (row['Cabin Number'] || row.cabinnumber || row.cabinNumber)?.trim();
                let cabin;
                let apSim = { created: 0, reused: 0 };
                if (cabinNumber) {
                    cabin = await Cabin.findOne({ building: building._id, number: { $regex: new RegExp(`^${cabinNumber}$`, 'i') } });
                    if (cabin) {
                        if (!dryRun) {
                            await Cabin.findByIdAndUpdate(cabin._id, {
                                allocatedTo: client._id,
                                contract: contractIdForSim,
                                status: 'occupied',
                                $push: {
                                    blocks: {
                                        client: client._id,
                                        contract: contractIdForSim,
                                        fromDate: startDate,
                                        toDate: endDate,
                                        status: 'active',
                                        reason: 'Bulk Contract Migration'
                                    }
                                }
                            });
                        }

                        // --- Access Provisioning simulation ---
                        try {
                            const apIdSet = new Set();
                            const matrixDevices = cabin.matrixDevices || [];
                            for (const did of matrixDevices) {
                                let ap = await AccessPoint.findOne({
                                    buildingId: building._id,
                                    "deviceBindings.deviceId": did,
                                }).select("_id").lean();

                                if (!ap) {
                                    apSim.created++;
                                    if (!dryRun) {
                                        const nameSuffix = String(did).slice(-6);
                                        const createdAp = await AccessPoint.create({
                                            buildingId: building._id,
                                            name: `AP ${cabin.number}-${nameSuffix}`,
                                            bindingType: "cabin",
                                            resource: { refType: "Cabin", refId: cabin._id, label: cabin.number },
                                            pointType: "DOOR",
                                            deviceBindings: [{ vendor: "MATRIX_COSEC", deviceId: did, direction: "BIDIRECTIONAL" }],
                                            status: "active",
                                        });
                                        apIdSet.add(String(createdAp._id));
                                    }
                                } else {
                                    apSim.reused++;
                                    if (!dryRun) apIdSet.add(String(ap._id));
                                }
                            }

                            if (!dryRun) {
                                const objectIdList = Array.from(apIdSet).map(id => new mongoose.Types.ObjectId(id));
                                const policyResult = await ensureDefaultAccessPolicyForContract(contractIdForSim);
                                let ensuredPolicy = policyResult?.policy;
                                if (!ensuredPolicy) {
                                    ensuredPolicy = await AccessPolicy.create({
                                        buildingId: building._id,
                                        name: "Default Access",
                                        description: `Auto-created at bulk migration`,
                                        accessPointIds: objectIdList,
                                        isDefaultForBuilding: true,
                                        effectiveFrom: startDate,
                                        effectiveTo: endDate,
                                    });
                                }
                                if (ensuredPolicy) {
                                    if (objectIdList.length > 0) {
                                        await AccessPolicy.updateOne({ _id: ensuredPolicy._id }, { $addToSet: { accessPointIds: { $each: objectIdList } } });
                                    }
                                    await grantOnContractActivation(contract, {
                                        policyId: ensuredPolicy._id,
                                        startsAt: startDate || new Date(),
                                        endsAt: endDate || undefined,
                                        source: "BULK_MIGRATION",
                                    });
                                }
                            }
                        } catch (accessErr) {
                        }
                    }
                }

                if (dryRun) {
                    rowResult.simulation = {
                        mrCreditsToGrant: credits,
                        printerCreditsToSync: printerCredits,
                        securityDeposit: {
                            agreed: depositAgreed,
                            totalPaid: totalPaidToApply,
                            installments: paymentsToCreate.length
                        },
                        addOns: contractAddOns,
                        cabin: cabin ? `Found (${cabin.number})` : (cabinNumber ? 'Not Found' : 'N/A'),
                        accessPoints: apSim
                    };
                    rowResult.success = true;
                    results.push(rowResult);
                    continue;
                }

                successCount++;
                rowResult.success = true;
                results.push(rowResult);

            } catch (rowErr) {
                console.error(`Row processing error:`, rowErr);
                results.push({ ...row, status: 'Error', errors: [rowErr.message] });
            }
        }

        return res.json({ success: true, dryRun, count: dryRun ? rows.length : successCount, results });
    } catch (error) {
        console.error('bulkImportContracts error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

