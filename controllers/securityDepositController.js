import mongoose from "mongoose";
import SecurityDeposit from "../models/securityDepositModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Payment from "../models/paymentModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { createZohoInvoiceFromLocal, findOrCreateContactFromClient } from "../utils/zohoBooks.js";
import { generateSecurityDepositNote } from "../services/securityDepositNoteService.js";
import imagekit from "../utils/imageKit.js";
import { getUsersByRoles } from "../utils/contractEmailService.js";
import { sendNotification } from "../utils/notificationHelper.js";

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
      .populate('contract', 'startDate endDate status')
      .populate('invoice_id', 'invoice_number total amount_paid balance status date due_date');
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
      .populate('invoice_id', 'invoice_number total amount_paid balance status due_date')
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

    if (dep.invoice_id) {
      const inv = await Invoice.findById(dep.invoice_id);
      return res.json({ success: true, message: 'Invoice already exists for this deposit', data: { deposit: dep, invoice: inv } });
    }

    const invoiceNumber = await generateLocalInvoiceNumber();
    const subtotal = round2(dep.agreed_amount);
    const total = subtotal; // Non-GST

    const invoiceData = {
      invoice_number: invoiceNumber,
      client: dep.client,
      contract: dep.contract,
      building: dep.building || undefined,
      type: 'security_deposit',
      category: 'onboarding',
      date: new Date(),
      due_date: dueDate ? new Date(dueDate) : undefined,
      line_items: [
        {
          description: 'Security Deposit',
          quantity: 1,
          unitPrice: subtotal,
          amount: subtotal,
          name: 'Security Deposit',
          rate: subtotal,
          unit: 'nos',
          tax_percentage: 0,
          item_total: subtotal,
        },
      ],
      sub_total: subtotal,
      tax_total: 0,
      total,
      amount_paid: 0,
      balance: total,
      status: 'draft',
      notes: notes || 'Non-GST Security Deposit invoice',
      currency_code: 'INR',
      exchange_rate: 1,
      deposit: dep._id,
    };

    const invoice = await Invoice.create(invoiceData);

    dep.invoice_id = invoice._id;
    dep.amount_due = subtotal;
    dep.status = 'DUE';
    dep.due_date = invoice.due_date || new Date();
    await dep.save();

    // Auto-push to Zoho Books (as draft). Non-blocking.
    try {
      // Ensure Zoho contact
      let clientDoc = dep.client;
      if (!clientDoc || !clientDoc._id) {
        clientDoc = await Client.findById(dep.client);
      }
      if (clientDoc && !clientDoc.zohoBooksContactId) {
        const contactId = await findOrCreateContactFromClient(clientDoc);
        if (contactId) {
          clientDoc.zohoBooksContactId = contactId;
          await clientDoc.save();
        }
      }

      if (clientDoc && clientDoc.zohoBooksContactId) {
        const zohoResp = await createZohoInvoiceFromLocal(invoice.toObject(), clientDoc.toObject());
        const zohoId = zohoResp?.invoice?.invoice_id;
        const zohoNumber = zohoResp?.invoice?.invoice_number;
        if (zohoId) {
          invoice.zoho_invoice_id = zohoId;
          invoice.zoho_invoice_number = zohoNumber || invoice.zoho_invoice_number;
          invoice.source = invoice.source || 'zoho';
          invoice.zoho_status = 'draft';
          await invoice.save();
        }
      }
    } catch (pushErr) {
      console.warn('Auto push of security deposit invoice to Zoho failed (non-blocking):', pushErr?.message);
    }

    await logCRUDActivity(req, 'UPDATE', 'SecurityDeposit', dep._id, null, { action: 'MARK_DUE', invoiceId: invoice._id });
    return res.status(201).json({ success: true, data: { deposit: dep, invoice } });
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

export const applyPaymentToDeposit = async (invoiceId, amountApplied) => {
  try {
    const inv = await Invoice.findById(invoiceId).select('_id deposit');
    if (!inv) return null;

    let dep = null;
    if (inv.deposit) {
      dep = await SecurityDeposit.findById(inv.deposit);
    } else {
      dep = await SecurityDeposit.findOne({ invoice_id: invoiceId });
    }
    if (!dep) return null;

    dep.amount_paid = round2(Number(dep.amount_paid || 0) + Number(amountApplied || 0));
    if (!dep.paid_date) dep.paid_date = new Date();
    dep.status = recomputeStatus(dep);
    await dep.save();

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

    // Also attach these URLs to the latest related Payment (single- or multi-invoice payments)
    try {
      // Collect invoice ids related to this deposit
      let invoiceIds = [];
      if (dep.invoice_id) {
        invoiceIds = [dep.invoice_id];
      } else {
        const invs = await Invoice.find({ deposit: dep._id }).select('_id');
        invoiceIds = invs.map((i) => i._id);
      }

      if (invoiceIds.length > 0) {
        const latestPayment = await Payment.findOne({
          $or: [
            { invoice: { $in: invoiceIds } },
            { 'invoices.invoice': { $in: invoiceIds } },
          ],
        })
          .sort({ createdAt: -1 })
          .select('images');

        if (latestPayment) {
          const existing = Array.isArray(latestPayment.images) ? latestPayment.images : [];
          const merged = Array.from(new Set([...(existing || []), ...urls]));
          if (merged.length !== existing.length) {
            latestPayment.images = merged;
            await latestPayment.save();
          }
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
