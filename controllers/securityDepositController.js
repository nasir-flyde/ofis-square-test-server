import mongoose from "mongoose";
import SecurityDeposit from "../models/securityDepositModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { createZohoInvoiceFromLocal, findOrCreateContactFromClient } from "../utils/zohoBooks.js";

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
    const { clientId, contractId, buildingId, agreedAmount, currency = "INR", notes } = req.body || {};
    if (!clientId || !contractId || agreedAmount == null) {
      return res.status(400).json({ success: false, message: "clientId, contractId, agreedAmount are required" });
    }
    if (!mongoose.Types.ObjectId.isValid(clientId) || !mongoose.Types.ObjectId.isValid(contractId)) {
      return res.status(400).json({ success: false, message: "Invalid clientId or contractId" });
    }

    const [client, contract] = await Promise.all([
      Client.findById(clientId).select("_id"),
      Contract.findById(contractId).select("_id building"),
    ]);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    const dep = await SecurityDeposit.create({
      client: client._id,
      contract: contract._id,
      building: buildingId || contract.building || undefined,
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

    await logCRUDActivity(req, 'CREATE', 'SecurityDeposit', dep._id, null, { clientId, contractId, agreedAmount });
    return res.status(201).json({ success: true, data: dep });
  } catch (error) {
    await logErrorActivity(req, error, 'Create SecurityDeposit');
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

// Internal helper: update deposit on payment application
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
    return dep;
  } catch (e) {
    // Non-blocking
    return null;
  }
};
