import mongoose from "mongoose";
import SecurityDeposit from "../models/securityDepositModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { generateSecurityDepositNote } from "../services/securityDepositNoteService.js";
import imagekit from "../utils/imageKit.js";
import { getUsersByRoles } from "../utils/contractEmailService.js";
import { sendNotification } from "../utils/notificationHelper.js";
import { ensureSecurityDepositHierarchy, recordSDAgreementJournal, recordSDPaymentJournal } from "../services/securityDepositCOAService.js";
import SecurityDepositPayment from "../models/securityDepositPaymentModel.js";

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

function recomputeStatus(dep) {
  const paid = Number(dep.amount_paid || 0);
  const due = Number(dep.amount_due || 0);
  const out = Number(dep.amount_adjusted || 0) + Number(dep.amount_refunded || 0) + Number(dep.amount_forfeited || 0);
  const held = Math.max(0, paid - out);

  if (held === 0 && (out > 0 || paid > 0)) {
    return "CLOSED";
  }
  if ((dep.amount_adjusted || 0) > 0) {
    return "PARTIALLY_ADJUSTED";
  }
  if (paid >= due && due > 0) {
    return "PAID";
  }
  if (due > 0) return "DUE";
  return dep.status || "AGREED";
}

export const createDeposit = async (req, res) => {
  try {
    const { clientId, contractId, buildingId, cabinId, agreedAmount, currency = "INR", notes } = req.body || {};
    if (!clientId || agreedAmount == null) {
      return res.status(400).json({ success: false, message: "clientId and agreedAmount are required" });
    }
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ success: false, message: "Invalid clientId" });
    }
    if (contractId && !mongoose.Types.ObjectId.isValid(contractId)) {
      return res.status(400).json({ success: false, message: "Invalid contractId" });
    }

    const client = await Client.findById(clientId).select("_id email companyName contactPerson");
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    let contract = null;
    if (contractId) {
      contract = await Contract.findById(contractId).select("_id building");
      if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });
    }

    const dep = await SecurityDeposit.create({
      client: client._id,
      contract: contract ? contract._id : undefined,
      building: buildingId || (contract ? contract.building : undefined) || undefined,
      cabin: cabinId || undefined,
      agreed_amount: Number(agreedAmount),
      currency,
      status: "AGREED",
      notes: notes || undefined,
      amount_due: 0,
      amount_paid: 0,
      amount_adjusted: 0,
      amount_refunded: 0,
      amount_forfeited: 0,
    });

    // 1. Generate SD Note immediately
    let noteUrl = null;
    try {
      const noteResult = await generateSecurityDepositNote(dep._id, {
        signer: {
          name: req.user?.name || 'Authorized Signatory',
          email: req.user?.email,
          designation: req.user?.role || 'Finance Team'
        },
        force: true
      });
      noteUrl = noteResult?.url;
    } catch (noteErr) {
      console.error('Failed to auto-generate SD note:', noteErr);
    }

    // 2. Send Notifications (Email with Attachment)
    if (noteUrl) {
      const attachments = [{ filename: 'Security_Deposit_Note.pdf', path: noteUrl }];

      // Notify Client
      if (client.email) {
        try {
          await sendNotification({
            to: { email: client.email, clientId: client._id },
            channels: { email: true, sms: false },
            title: 'Security Deposit Note - Ofis Square',
            content: {
              emailSubject: 'Your Security Deposit Note from Ofis Square',
              emailHtml: `<p>Please find attached your Security Deposit Note.</p><p>Regards,<br>Ofis Square Team</p>`,
              emailText: `Please find attached your Security Deposit Note.\n\nRegards,\nOfis Square Team`
            },
            templateVariables: {
              greeting: client.contactPerson || client.companyName || 'Ofis Square'
            },
            attachments,
            source: 'system',
            type: 'transactional'
          });
        } catch (e) {
          console.error('Failed to send SD note email to client:', e);
        }
      }

      // Notify Finance Team
      try {
        const financeUsers = await getUsersByRoles(['finance', 'Finance', 'finance_team', 'Finance Team']);
        for (const user of financeUsers) {
          await sendNotification({
            to: { email: user.email, userId: user._id },
            channels: { email: true, sms: false },
            title: 'New Security Deposit Note Generated',
            content: {
              emailSubject: `New SD Note: ${client.companyName}`,
              emailHtml: `
                <p>A new Security Deposit Note has been generated for <strong>${client.companyName}</strong>.</p>
                <p>Amount: ${agreedAmount}</p>
                <p>Please find the note attached.</p>
              `,
              emailText: `A new Security Deposit Note has been generated for ${client.companyName}.\nAmount: ${agreedAmount}\nPlease find the note attached.`
            },
            templateVariables: {
              greeting: 'Ofis Square'
            },
            attachments,
            source: 'system',
            type: 'system'
          });
        }
      } catch (e) {
        console.error('Failed to send SD note email to finance team:', e);
      }
    }

    await logCRUDActivity(req, 'CREATE', 'SecurityDeposit', dep._id, null, { clientId, contractId, agreedAmount, noteGenerated: !!noteUrl });
    return res.status(201).json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Create SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { agreedAmount, notes, clientId, contractId, buildingId } = req.body || {};

    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: "SecurityDeposit not found" });

    if (agreedAmount !== undefined) {
      dep.agreed_amount = Number(agreedAmount);
    }
    if (notes !== undefined) {
      dep.notes = notes;
    }
    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      dep.client = clientId;
    }
    if (contractId && mongoose.Types.ObjectId.isValid(contractId)) {
      dep.contract = contractId;
    }
    if (buildingId && mongoose.Types.ObjectId.isValid(buildingId)) {
      dep.building = buildingId;
    }

    dep.status = recomputeStatus(dep);
    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'UPDATE', agreedAmount, notes });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Update SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getDepositById = async (req, res) => {
  try {
    const { id } = req.params;
    const dep = await SecurityDeposit.findById(id)
      .populate('client', 'companyName email phone')
      .populate('contract', 'startDate endDate status');
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Get SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listDeposits = async (req, res) => {
  try {
    const { client, contract, status, building, limit = 50, sort } = req.query || {};
    const filter = {};
    if (client) filter.client = client;
    if (contract) filter.contract = contract;
    if (status) filter.status = status;
    if (building) filter.building = building;

    // Default sort: newest first
    let sortObj = { createdAt: -1 };
    if (sort) {
      // Accept formats: 'createdAt:desc' or '-createdAt'
      if (sort.includes(':')) {
        const [field, dir] = sort.split(':');
        sortObj = { [field]: dir === 'asc' ? 1 : -1 };
      } else if (sort.startsWith('-')) {
        sortObj = { [sort.slice(1)]: -1 };
      } else {
        sortObj = { [sort]: 1 };
      }
    }

    const docs = await SecurityDeposit.find(filter)
      .populate('cabin', 'number floor status')
      .populate('cabin', 'number floor status')
      .sort(sortObj)
      .limit(Math.max(1, Math.min(Number(limit) || 50, 200)));

    return res.json({ success: true, data: docs });
  } catch (error) {
    await logErrorActivity(req, error, 'List SecurityDeposits');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markDepositDue = async (req, res) => {
  try {
    const { id } = req.params;
    const { dueDate, notes } = req.body || {};
    const dep = await SecurityDeposit.findById(id).populate('client').populate('contract');
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    dep.amount_due = round2(dep.agreed_amount);
    dep.status = 'DUE';
    dep.due_date = dueDate ? new Date(dueDate) : new Date();
    
    // Ensure Zoho COA Hierarchy exists and Record Agreement Journal
    try {
      if (dep.building && dep.client) {
        await ensureSecurityDepositHierarchy(dep.building, dep.client);
        // Step 1: Record Agreement Recognition in Zoho
        await recordSDAgreementJournal(dep._id, req.user?.name);
      }
    } catch (coaErr) {
      console.warn('Failed to ensure SD COA hierarchy or record agreement journal (non-blocking):', coaErr.message);
    }

    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'MARK_DUE' });
    return res.status(200).json({ success: true, data: { deposit: dep } });
  } catch (error) {
    await logErrorActivity(req, error, 'Mark SecurityDeposit Due');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adjustDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount = 0, note } = req.body || {};
    if (Number(amount) <= 0) return res.status(400).json({ success: false, message: 'amount must be > 0' });

    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    dep.amount_adjusted = round2(Number(dep.amount_adjusted || 0) + Number(amount));
    dep.status = recomputeStatus(dep);
    if (dep.status === 'CLOSED' && !dep.closed_date) dep.closed_date = new Date();
    if (note) dep.notes = [dep.notes, note].filter(Boolean).join(' | ');
    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'ADJUST', amount: Number(amount) });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Adjust SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const refundDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount = 0, note } = req.body || {};
    if (Number(amount) <= 0) return res.status(400).json({ success: false, message: 'amount must be > 0' });

    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    dep.amount_refunded = round2(Number(dep.amount_refunded || 0) + Number(amount));
    dep.status = recomputeStatus(dep);
    if (dep.status === 'CLOSED' && !dep.closed_date) dep.closed_date = new Date();
    if (note) dep.notes = [dep.notes, note].filter(Boolean).join(' | ');
    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'REFUND', amount: Number(amount) });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Refund SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const forfeitDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount = 0, note } = req.body || {};
    if (Number(amount) <= 0) return res.status(400).json({ success: false, message: 'amount must be > 0' });

    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    dep.amount_forfeited = round2(Number(dep.amount_forfeited || 0) + Number(amount));
    dep.status = recomputeStatus(dep);
    if (dep.status === 'CLOSED' && !dep.closed_date) dep.closed_date = new Date();
    if (note) dep.notes = [dep.notes, note].filter(Boolean).join(' | ');
    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'FORFEIT', amount: Number(amount) });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Forfeit SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const closeDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    dep.status = 'CLOSED';
    dep.closed_date = new Date();
    await dep.save();

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'CLOSE' });
    return res.json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Close SecurityDeposit');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Manually (re)generate Security Deposit Note PDF and upload to ImageKit
export const generateDepositNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { forceRegenerate = false, dynamicValues = [], stampUrl, signatureUrl, cabinId, sendNotification: shouldSend } = req.body || {};
    const dep = await SecurityDeposit.findById(id).populate('client');
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    if (cabinId && mongoose.Types.ObjectId.isValid(cabinId)) {
      dep.cabin = cabinId;
      await dep.save();
    }

    const result = await generateSecurityDepositNote(id, {
      signer: {
        name: req.user?.name || req.user?.fullName || req.user?.email,
        email: req.user?.email,
        phone: req.user?.phone,
        designation: req.user?.role || req.user?.designation,
      },
      dynamicValues,
      force: Boolean(forceRegenerate),
      // Allow overriding images via request; service also has sensible defaults
      stampUrl,
      signatureUrl,
    });

    const noteUrl = result?.url;

    // Send Notification if requested
    if (shouldSend && noteUrl) {
      const client = dep.client;
      if (client && client.email) {
        try {
          const attachments = [{ filename: 'Security_Deposit_Note.pdf', path: noteUrl }];
          await sendNotification({
            to: { email: client.email, clientId: client._id },
            channels: { email: true, sms: false },
            title: 'Security Deposit Note - Ofis Square',
            content: {
              emailSubject: 'Your Security Deposit Note from Ofis Square',
              emailHtml: `<p>Please find attached your Security Deposit Note.</p><p>Regards,<br>Ofis Square Team</p>`,
              emailText: `Please find attached your Security Deposit Note.\n\nRegards,\nOfis Square Team`
            },
            templateVariables: {
              greeting: client.contactPerson || client.companyName || 'Ofis Square'
            },
            attachments,
            source: 'system',
            type: 'transactional'
          });
        } catch (e) {
          console.error('Failed to send SD note email to client:', e);
        }
      }
    }

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', id, null, { action: 'GENERATE_SD_NOTE', url: noteUrl, sentToClient: !!shouldSend });
    return res.json({ success: true, data: { url: noteUrl } });
  } catch (error) {
    await logErrorActivity(req, error, 'Generate SecurityDeposit Note');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const applyPaymentToDeposit = async (depositId, amountApplied, paymentRef = null) => {
  try {
    // 1. Find the deposit
    let dep = await SecurityDeposit.findById(depositId);
    
    if (!dep) return null;

    const oldPaid = Number(dep.amount_paid || 0);
    dep.amount_paid = round2(oldPaid + Number(amountApplied || 0));
    if (!dep.paid_date) dep.paid_date = new Date();
    dep.status = recomputeStatus(dep);
    await dep.save();

    // 2. Create the SecurityDepositPayment record
    let sdPayment = null;
    try {
      sdPayment = await SecurityDepositPayment.create({
        deposit: dep._id,
        client: dep.client,
        building: dep.building,
        amount: Number(amountApplied),
        paymentDate: new Date(),
        type: paymentRef?.includes('MIGRATION') ? 'Bank Transfer' : 'Other',
        referenceNumber: paymentRef || undefined,
        source: paymentRef?.includes('MIGRATION') ? 'migration' : 'manual'
      });
    } catch (saveErr) {
      console.warn('Failed to create SecurityDepositPayment record (non-blocking):', saveErr.message);
    }

    // 3. Record Journal Entry in Zoho Books (Step 2: Payment Receipt)
    if (Number(amountApplied) > 0) {
      try {
        const journal = await recordSDPaymentJournal(dep._id, amountApplied, paymentRef);
        if (journal && journal.journal_id && sdPayment) {
          sdPayment.zoho_journal_id = journal.journal_id;
          sdPayment.zoho_journal_number = journal.journal_number;
          await sdPayment.save();
        }
      } catch (journalErr) {
        console.warn('Failed to record SD payment journal entry (non-blocking):', journalErr.message);
      }
    }

    // SD Note generation policy...

    // SD Note generation policy:
    // - If a note already exists, any payment change on the SD invoice regenerates and REPLACES the URL (force = true)
    // - If no note exists yet, generate it when the deposit becomes fully PAID
    try {
      if (dep.sdNoteUrl) {
        await generateSecurityDepositNote(dep._id, {
          signer: { name: 'System' },
          dynamicValues: [],
          force: true,
        });
      } else if (dep.status === 'PAID') {
        await generateSecurityDepositNote(dep._id, {
          signer: { name: 'System' },
          dynamicValues: [],
          force: false,
        });
      }
    } catch (_) { /* non-blocking */ }

    return dep;
  } catch (e) {
    // Non-blocking
    return null;
  }
};

// POST /api/security-deposits/:id/images
// Upload images/screenshots and attach their URLs to the deposit.images array
export const uploadDepositImages = async (req, res) => {
  try {
    const { id } = req.params;
    const dep = await SecurityDeposit.findById(id);
    if (!dep) return res.status(404).json({ success: false, message: 'SecurityDeposit not found' });

    const folder = process.env.IMAGEKIT_SECURITY_DEPOSIT_FOLDER || "/ofis-square/security-deposits";
    const files = [
      ...(Array.isArray(req?.files?.images) ? req.files.images : []),
      ...(Array.isArray(req?.files?.screenshots) ? req.files.screenshots : []),
    ];

    if (!files.length) {
      return res.status(400).json({ success: false, message: 'No files provided' });
    }

    const uploads = files.map(async (file) => {
      const result = await imagekit.upload({
        file: file.buffer,
        fileName: `security_deposit_${Date.now()}_${file.originalname}`,
        folder,
      });
      return result.url;
    });
    const urls = await Promise.all(uploads);

    dep.images = [...(dep.images || []), ...urls];
    await dep.save();

    // Also attach these URLs to the latest related SD Payment
    try {
      const latestSDPayment = await SecurityDepositPayment.findOne({ deposit: dep._id })
        .sort({ createdAt: -1 });

      if (latestSDPayment) {
        const existing = Array.isArray(latestSDPayment.images) ? latestSDPayment.images : [];
        const merged = Array.from(new Set([...existing, ...urls]));
        if (merged.length !== existing.length) {
          latestSDPayment.images = merged;
          await latestSDPayment.save();
        }
      }
    } catch (e) {
      // non-blocking
    }

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'ADD_IMAGES', count: urls.length });
    return res.json({ success: true, data: { images: dep.images, added: urls } });
  } catch (error) {
    await logErrorActivity(req, error, 'Upload SecurityDeposit Images');
    return res.status(500).json({ success: false, message: error.message });
  }
};
