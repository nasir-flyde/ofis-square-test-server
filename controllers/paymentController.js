import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import DayPass from "../models/dayPassModel.js";
import DayPassBundle from "../models/dayPassBundleModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Contract from "../models/contractModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import { issueDayPass, issueDayPassBatch } from "../services/dayPassIssuanceService.js";
import { getValidAccessToken } from '../utils/zohoTokenManager.js';
import crypto from 'crypto';
import { logPaymentActivity, logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import loggedRazorpay from "../utils/loggedRazorpay.js";
import apiLogger from "../utils/apiLogger.js";
import { applyPaymentToDeposit } from "./securityDepositController.js";
import imagekit from "../utils/imageKit.js";
import { getZohoCustomerPayment, updateZohoCustomerPayment, refundZohoExcessPayment, getZohoInvoice, createZohoInvoiceFromLocal, recordZohoPayment } from "../utils/zohoBooks.js";

// Helper: update invoice aggregates after a payment change
async function applyInvoicePayment(invoiceId, deltaAmount) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  // Use snake_case fields as per invoiceModel, and mirror to camelCase for compatibility
  const prevPaid = Number(invoice.amount_paid || 0);
  const newPaid = Math.max(0, Math.round((prevPaid + Number(deltaAmount || 0)) * 100) / 100);
  invoice.amount_paid = newPaid; // primary
  invoice.amountPaid = newPaid;  // mirror for legacy consumers

  const total = Number(invoice.total || 0);
  const newBalance = Math.max(0, Math.round((total - newPaid) * 100) / 100);
  invoice.balance = newBalance;   // primary
  invoice.balanceDue = newBalance; // mirror for legacy consumers

  // Update status
  if (newBalance === 0) {
    invoice.status = "paid";
    invoice.paid_at = invoice.paid_at || new Date();
  } else if (invoice.status !== "void") {
    const now = new Date();
    const due = invoice.due_date ? new Date(invoice.due_date) : null;
    if (due && now > due) {
      invoice.status = "overdue";
    } else {
      // If a payment has been made but balance remains, mark partially_paid; otherwise issued
      invoice.status = newPaid > 0 ? "partially_paid" : (invoice.status === "draft" ? "issued" : (invoice.status || "issued"));
    }
  }

  invoice.last_payment_date = new Date();
  await invoice.save();
  return invoice;
}

// POST /api/payments
export const createPayment = async (req, res) => {
  try {
    const { invoice: invoiceId, client, amount, paymentDate, type, referenceNumber, paymentGatewayRef, currency, notes, bankName, accountNumber, screenshots: bodyScreenshots } = req.body || {};

    if (!invoiceId) return res.status(400).json({ success: false, message: "invoice is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount must be > 0" });
    if (!paymentDate) return res.status(400).json({ success: false, message: "paymentDate is required" });

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // If client is provided, optionally validate matches invoice client
    if (client && String(client) !== String(invoice.client)) {
      return res.status(400).json({ success: false, message: "Payment client does not match invoice client" });
    }

    // Normalize payment type to match Payment enum
    const typeMap = {
      'cash': 'Cash',
      'bank transfer': 'Bank Transfer',
      'banktransfer': 'BankTransfer',
      'upi': 'UPI',
      'card': 'Card',
      'creditcard': 'CreditCard',
      'credits': 'Credits',
      'debitcard': 'DebitCard',
      'cheque': 'Cheque',
      'online gateway': 'Online Gateway',
      'paypal': 'PayPal',
      'razorpay': 'Razorpay',
      'stripe': 'Stripe',
      'other': 'Other',
    };
    const normalizedType = type ? (typeMap[String(type).trim().toLowerCase()] || type) : undefined;

    // Handle file uploads to ImageKit for screenshots and images
    let uploadedScreenshotUrls = [];
    let uploadedImageUrls = [];
    const folder = process.env.IMAGEKIT_PAYMENT_FOLDER || "/ofis-square/payments";
    try {
      // When using upload.fields, req.files is an object: { screenshots: [..], images: [..] }
      const screenshotsFiles = Array.isArray(req?.files?.screenshots) ? req.files.screenshots : [];
      const imagesFiles = Array.isArray(req?.files?.images) ? req.files.images : [];

      if (screenshotsFiles.length > 0) {
        const uploads = screenshotsFiles.map(async (file) => {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `payment_screenshot_${Date.now()}_${file.originalname}`,
            folder,
          });
          return result.url;
        });
        uploadedScreenshotUrls = await Promise.all(uploads);
      }

      if (imagesFiles.length > 0) {
        const uploads = imagesFiles.map(async (file) => {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `payment_image_${Date.now()}_${file.originalname}`,
            folder,
          });
          return result.url;
        });
        uploadedImageUrls = await Promise.all(uploads);
      }
    } catch (uploadErr) {
      await logErrorActivity(req, uploadErr, 'Upload Payment Images');
      return res.status(500).json({ success: false, message: `Failed to upload images: ${uploadErr.message}` });
    }

    // Also support screenshots provided as URLs/base64 array in body (fallback) and map to images only
    const payloadScreenshotUrls = Array.isArray(bodyScreenshots) ? bodyScreenshots : [];
    const allImageUrls = [
      ...uploadedImageUrls,
      ...uploadedScreenshotUrls,
      ...payloadScreenshotUrls,
    ].filter(Boolean);

    const payment = await Payment.create({
      invoice: invoiceId,
      client: client || invoice.client,
      type: normalizedType || undefined, // defaults to schema default
      referenceNumber: referenceNumber || undefined,
      paymentGatewayRef: paymentGatewayRef || undefined,
      amount: Number(amount),
      paymentDate: new Date(paymentDate),
      currency: currency || undefined,
      notes: notes || undefined,
      bankName: bankName || undefined,
      accountNumber: accountNumber || undefined,
      images: allImageUrls.length ? allImageUrls : undefined,
    });

    const updatedInvoice = await applyInvoicePayment(invoiceId, Number(amount));
    // Update linked security deposit if this is a deposit invoice
    try { await applyPaymentToDeposit(invoiceId, Number(amount)); } catch (_) {}

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_MADE', 'Payment', payment._id, {
      invoiceId,
      amount: Number(amount),
      paymentType: normalizedType,
      referenceNumber
    });

    return res.status(201).json({ success: true, data: { payment, invoice: updatedInvoice } });
  } catch (error) {
    await logErrorActivity(req, error, 'Create Payment');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/payments/:id
export const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }
    try {
      const invoiceExists = await Invoice.findById(payment.invoice).select('_id');
      if (invoiceExists) {
        await applyInvoicePayment(payment.invoice, -Number(payment.amount || 0));
        // Reverse deposit applied amount as well
        try { await applyPaymentToDeposit(payment.invoice, -Number(payment.amount || 0)); } catch (_) {}
      }
    } catch (_) {
    }

    await Payment.findByIdAndDelete(id);

    // Log payment deletion
    await logCRUDActivity(req, 'DELETE', 'Payment', id, null, {
      invoiceId: payment.invoice,
      amount: payment.amount,
      paymentType: payment.type
    });

    return res.json({ success: true, message: "Payment deleted successfully", deletedPaymentId: id });
  } catch (error) {
    await logErrorActivity(req, error, 'Delete Payment');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/payments
export const getPayments = async (req, res) => {
  try {
    const { invoice, client, type, from, to } = req.query || {};
    const filter = {};
    if (invoice) filter.invoice = invoice;
    if (client) filter.client = client;
    if (type) filter.type = type;
    if (from || to) {
      filter.paymentDate = {};
      if (from) filter.paymentDate.$gte = new Date(from);
      if (to) filter.paymentDate.$lte = new Date(to);
    }

    const payments = await Payment.find(filter)
      .populate("invoice", "invoice_number total amount_paid balance due_date status")
      .populate("client", "companyName contactPerson phone email")
      .sort({ paymentDate: -1, createdAt: -1 });

    return res.json({ success: true, data: payments });
  } catch (error) {
    await logErrorActivity(req, error, 'Get Payments');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/payments/:id
export const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id)
      .populate("invoice", "invoice_number total amount_paid balance due_date status")
      .populate("client", "companyName contactPerson phone email");
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.json({ success: true, data: payment });
  } catch (error) {
    await logErrorActivity(req, error, 'Get Payment by ID');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /clients/payments - Client-specific payments endpoint
export const getClientPayments = async (req, res) => {
  try {
    const clientId = req.clientId; // from clientMiddleware
    if (!clientId) {
      return res.status(400).json({ error: "Client ID not found in token" });
    }

    const { page = 1, limit = 10, type, from, to } = req.query;
    const query = { client: clientId };
    
    if (type) query.type = type;
    if (from || to) {
      query.paymentDate = {};
      if (from) query.paymentDate.$gte = new Date(from);
      if (to) query.paymentDate.$lte = new Date(to);
    }

    const payments = await Payment.find(query)
      .populate("invoice", "invoice_number total amount_paid balance due_date status building cabin")
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Payment.countDocuments(query);

    return res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (err) {
    console.error("getClientPayments error:", err);
    await logErrorActivity(req, err, 'Get Client Payments');
    return res.status(500).json({ error: "Failed to fetch client payments" });
  }
};
const getBooksBaseUrl = () => {
  return "https://www.zohoapis.in/books/v3";
};

const getOrgId = () => {
  return process.env.ZOHO_ORG_ID;
};

const generateIdempotencyKey = (payload) => {
  const keyData = `${payload.customer_id}-${payload.amount}-${payload.date}-${payload.reference_number}-${JSON.stringify(payload.invoices)}`;
  return crypto.createHash('sha256').update(keyData).digest('hex');
};

// Helper: update invoice balance after Zoho payment
// Now supports withheldDelta (local tax withheld by payer) in addition to cash amountApplied
async function updateInvoiceAfterZohoPayment(invoiceId, amountApplied, withheldDelta = 0) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return;

  const newAmountPaid = Math.max(0, Number(invoice.amount_paid || 0) + Number(amountApplied));
  const newWithheld = Math.max(0, Number(invoice.tax_withheld_total || 0) + Number(withheldDelta || 0));
  const newBalance = Math.max(0, Number(invoice.total || 0) - newAmountPaid - newWithheld);
  
  invoice.amount_paid = newAmountPaid;
  invoice.balance = newBalance;
  invoice.tax_withheld_total = newWithheld;
  
  // Update status based on balance
  if (newBalance === 0) {
    invoice.status = "paid";
    invoice.paid_at = new Date();
  } else if (invoice.status === "draft") {
    invoice.status = "partially_paid";
  } else if (invoice.status !== "partially_paid") {
    invoice.status = "partially_paid";
  }
  
  invoice.last_payment_date = new Date();
  await invoice.save();
  return invoice;
}

// Helper: sanitize Zoho address fields to avoid length violations
function sanitizeZohoAddress(addr) {
  if (!addr || typeof addr !== 'object') return undefined;
  const clip = (s, max) => (typeof s === 'string' ? s.slice(0, max) : undefined);
  return {
    attention: clip(addr.attention, 50),
    address: clip(addr.address, 100),
    street2: clip(addr.street2, 100),
    city: clip(addr.city, 50),
    state: clip(addr.state, 50),
    zip: clip(addr.zip, 20),
    country: clip(addr.country, 50),
    phone: clip(addr.phone, 30),
  };
}

async function createInvoiceInZoho(invoice, client) {
  const accessToken = await getValidAccessToken();
  const orgId = getOrgId();

  if (!orgId) {
    throw new Error('ZOHO_ORG_ID not configured');
  }

  if (!client.zohoBooksContactId) {
    throw new Error('Client must be linked to Zoho Books');
  }

  // Build Zoho invoice payload from local invoice
  const zohoInvoicePayload = {
    customer_id: client.zohoBooksContactId,
    date: invoice.date ? new Date(invoice.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    due_date: invoice.due_date ? new Date(invoice.due_date).toISOString().split('T')[0] : new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
    reference_number: invoice.reference_number || '',
    notes: invoice.notes || '',
    terms: invoice.terms || '',
    
    // Line items
    line_items: invoice.line_items.map(item => ({
      name: item.name || item.description,
      description: item.description,
      rate: item.unitPrice || item.rate,
      quantity: item.quantity,
      unit: item.unit || 'nos',
      tax_percentage: item.tax_percentage || 18
    })),
    
    // Totals
    sub_total: invoice.sub_total || 0,
    discount: invoice.discount || 0,
    discount_type: invoice.discount_type || 'entity_level',
    tax_total: invoice.tax_total || 0,
    total: invoice.total || 0,
    
    // Additional fields
    currency_code: invoice.currency_code || 'INR',
    exchange_rate: invoice.exchange_rate || 1,
    payment_terms: invoice.payment_terms || 30,
    payment_terms_label: invoice.payment_terms_label || 'Net 30',
    shipping_charge: invoice.shipping_charge || 0,
    adjustment: invoice.adjustment || 0,
    adjustment_description: invoice.adjustment_description || '',
    is_inclusive_tax: invoice.is_inclusive_tax || false
  };

  // Add billing address if available (sanitized to Zoho limits)
  if (invoice.billing_address && Object.keys(invoice.billing_address).length > 0) {
    zohoInvoicePayload.billing_address = sanitizeZohoAddress(invoice.billing_address);
  }

  // Add shipping address if available (sanitized to Zoho limits)
  if (invoice.shipping_address && Object.keys(invoice.shipping_address).length > 0) {
    zohoInvoicePayload.shipping_address = sanitizeZohoAddress(invoice.shipping_address);
  }

  // Call Zoho Books API to create invoice
  const zohoUrl = `${getBooksBaseUrl()}/invoices?organization_id=${orgId}`;
  const zohoResponse = await fetch(zohoUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(zohoInvoicePayload)
  });

  const zohoData = await zohoResponse.json();

  if (!zohoResponse.ok) {
    console.error('Zoho Books invoice creation error:', zohoData);
    throw new Error(`Zoho Books error: ${zohoData.message || 'Failed to create invoice'}`);
  }

  const zohoInvoiceId = zohoData.invoice?.invoice_id;
  const zohoInvoiceNumber = zohoData.invoice?.invoice_number;
  
  if (!zohoInvoiceId) {
    throw new Error('No invoice_id returned from Zoho Books');
  }

  // Update the local invoice with Zoho Books data
  invoice.zoho_invoice_id = zohoInvoiceId;
  invoice.zoho_invoice_number = zohoInvoiceNumber;
  invoice.source = 'zoho';
  await invoice.save();

  console.log(`✅ Updated local invoice ${invoice.invoice_number} with Zoho invoice number: ${zohoInvoiceNumber}`);

  return {
    zoho_invoice_id: zohoInvoiceId,
    zoho_invoice_number: zohoInvoiceNumber,
    zoho_data: zohoData.invoice
  };
}

export const recordCustomerPayment = async (req, res) => {
  try {
    const {
      clientId,
      invoices,
      payment_mode = 'BankTransfer',
      amount,
      date,
      reference_number,
      description,
      deposit_to_account_id
    } = req.body;

    // Validation
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }

    if (!amount || !date) {
      return res.status(400).json({
        success: false,
        message: 'Amount and date are required'
      });
    }

    // Validate amount allocation
    const safeInvoices = (Array.isArray(invoices) ? invoices : []).map((inv) => ({
      invoiceId: inv.invoiceId,
      amount_applied: Number(inv.amount_applied || 0),
      tax_deducted: Boolean(inv.tax_deducted || false),
      tax_amount_withheld: Number(inv.tax_amount_withheld || 0),
    }));
    const totalAllocated = safeInvoices.reduce((sum, inv) => sum + Number(inv.amount_applied), 0);
    const paymentAmountNum = Number(amount);
    // Allow totalAllocated <= amount (excess overpayment will be stored as extra credits)
    if ((totalAllocated - paymentAmountNum) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Total allocated amount (${totalAllocated}) cannot exceed payment amount (${amount})`
      });
    }

    // Fetch client and validate Zoho integration
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    if (!client.zohoBooksContactId) {
      return res.status(400).json({
        success: false,
        message: 'Client must be linked to Zoho Books before recording payments. Please sync the client first.'
      });
    }

    // Fetch and validate invoices
    const invoiceIds = safeInvoices.map(inv => inv.invoiceId);
    const dbInvoices = await Invoice.find({ _id: { $in: invoiceIds } });
    
    if (dbInvoices.length !== safeInvoices.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more invoices not found'
      });
    }

    // Validate all invoices belong to the same client
    const invalidInvoices = dbInvoices.filter(inv => inv.client.toString() !== clientId);
    if (invalidInvoices.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'All invoices must belong to the same client'
      });
    }

    // Additional preflight: validate against Zoho's current balance to avoid API rejection if local data is stale
    for (const paymentInv of safeInvoices) {
      const dbInvoice = dbInvoices.find(inv => inv._id.toString() === paymentInv.invoiceId);
      if (!dbInvoice?.zoho_invoice_id) continue; // if not synced yet, it will be created below
      try {
        const zohoInv = await getZohoInvoice(dbInvoice.zoho_invoice_id);
        const zohoOutstanding = Number(
          (zohoInv && (zohoInv.balance || zohoInv.balance_due || zohoInv.outstanding)) ?? 0
        );
        if (Number(paymentInv.amount_applied) > (zohoOutstanding + 0.01)) {
          return res.status(400).json({
            success: false,
            message: `Allocation ₹${paymentInv.amount_applied} exceeds Zoho balance ₹${zohoOutstanding} for invoice ${dbInvoice.invoice_number}. Please refresh and try again.`
          });
        }
      } catch (_) {
        // Non-blocking if Zoho fetch fails; let main flow proceed to either create invoice in Zoho or error there
      }
    }

    // Auto-create invoices in Zoho Books if they don't have zoho_invoice_id
    for (const dbInvoice of dbInvoices) {
      if (!dbInvoice.zoho_invoice_id) {
        console.log(`Creating invoice ${dbInvoice.invoice_number} in Zoho Books...`);
        
        try {
          const zohoResult = await createInvoiceInZoho(dbInvoice, client);
          console.log(`✅ Invoice ${dbInvoice.invoice_number} created in Zoho with number: ${zohoResult.zoho_invoice_number}`);
        } catch (error) {
          console.error(`❌ Failed to create invoice ${dbInvoice.invoice_number} in Zoho:`, error.message);
          return res.status(400).json({
            success: false,
            message: `Failed to create invoice ${dbInvoice.invoice_number} in Zoho Books: ${error.message}`
          });
        }
      }
    }

    // Validate payment amounts don't exceed outstanding balances (consider withheld in same operation)
    for (const paymentInv of safeInvoices) {
      const dbInvoice = dbInvoices.find(inv => inv._id.toString() === paymentInv.invoiceId);
      const outstanding = Number(dbInvoice.balance || dbInvoice.total || 0);
      const withheldReq = paymentInv.tax_deducted ? Number(paymentInv.tax_amount_withheld || 0) : 0;
      if (withheldReq < 0) {
        return res.status(400).json({ success: false, message: `Withheld amount must be >= 0 for invoice ${dbInvoice.invoice_number}` });
      }
      if (Number(paymentInv.amount_applied) + withheldReq > outstanding + 0.01) {
        return res.status(400).json({
          success: false,
          message: `Cash + Withheld (₹${Number(paymentInv.amount_applied) + withheldReq}) exceeds outstanding (₹${outstanding}) for invoice ${dbInvoice.invoice_number}`
        });
      }
    }

    // Build adjusted allocations: cap each by Zoho's current outstanding and local outstanding (consider withheld)
    const adjustedAllocations = [];
    const allowedByLocalId = new Map(); // local invoiceId -> allowed amount
    const withheldByLocalId = new Map(); // track withheld specified per invoice
    for (const inv of safeInvoices) {
      const dbInvoice = dbInvoices.find(dbInv => dbInv._id.toString() === inv.invoiceId);
      if (!dbInvoice) continue;
      let requested = Number(inv.amount_applied) || 0;
      let localOutstanding = Number(dbInvoice.balance || dbInvoice.total || 0);
      const withheldReq = inv.tax_deducted ? Number(inv.tax_amount_withheld || 0) : 0;
      let zohoOutstanding = localOutstanding;
      if (dbInvoice.zoho_invoice_id) {
        try {
          const zInv = await getZohoInvoice(dbInvoice.zoho_invoice_id);
          const zBal = Number(zInv?.balance || zInv?.balance_due || zInv?.outstanding || 0);
          if (!Number.isNaN(zBal)) zohoOutstanding = zBal;
        } catch (_) {
          // Non-blocking if Zoho fetch fails, continue with localOutstanding
        }
      }
      // ensure cash + withheld <= local outstanding
      const maxCashConsideringWithheld = Math.max(0, localOutstanding - withheldReq);
      const allowed = Math.max(0, Math.min(requested, maxCashConsideringWithheld, zohoOutstanding));
      const allowedRounded = Math.round(allowed * 100) / 100;
      const withheldRounded = Math.round(Math.max(0, withheldReq) * 100) / 100;

      // Build per-invoice Zoho payload; include TDS/withheld if specified
      const payloadItem = { invoice_id: dbInvoice.zoho_invoice_id, amount_applied: allowedRounded };
      if (withheldRounded > 0.009) {
        payloadItem.tax_amount_withheld = withheldRounded;
      }

      // Include invoice if there is either a cash application or a withheld amount
      if (allowedRounded > 0.009 || withheldRounded > 0.009) {
        adjustedAllocations.push(payloadItem);
      }

      allowedByLocalId.set(inv.invoiceId, allowedRounded);
      withheldByLocalId.set(inv.invoiceId, withheldRounded);
    }

    // Prepare Zoho Books payload using adjusted allocations; remainder (if any) becomes unused in Zoho
    const zohoPayload = {
      customer_id: client.zohoBooksContactId,
      payment_mode,
      amount: paymentAmountNum,
      date,
      invoices: adjustedAllocations,
      reference_number: reference_number || '',
      description: description || `Payment for ${safeInvoices.length} invoice(s)`
    };

    if (deposit_to_account_id) {
      zohoPayload.deposit_to_account_id = deposit_to_account_id;
    }

    try {
      console.log("[recordCustomerPayment] Zoho payload amount:", zohoPayload.amount);
      console.log("[recordCustomerPayment] Zoho payload invoices:", (zohoPayload.invoices || []).map(i => ({ invoice_id: i.invoice_id, amount_applied: i.amount_applied, tax_amount_withheld: i.tax_amount_withheld })));
    } catch (_) {}

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(zohoPayload);

    // Check if payment already exists
    const existingPayment = await Payment.findOne({ idempotency_key: idempotencyKey });
    if (existingPayment) {
      return res.status(200).json({
        success: true,
        message: 'Payment already recorded',
        data: existingPayment
      });
    }

    // Get Zoho access token
    const accessToken = await getValidAccessToken();
    const orgId = getOrgId();

    if (!orgId) {
      return res.status(500).json({
        success: false,
        message: 'ZOHO_ORG_ID not configured'
      });
    }

    // Call Zoho Books API
    const zohoUrl = `${getBooksBaseUrl()}/customerpayments?organization_id=${orgId}`;
    try {
      console.log('[recordCustomerPayment] POST URL:', zohoUrl);
      console.log('[recordCustomerPayment] Full payload:', JSON.stringify(zohoPayload, null, 2));
    } catch (_) {}
    const zohoResponse = await fetch(zohoUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(zohoPayload)
    });

    const zohoData = await zohoResponse.json();

    if (!zohoResponse.ok) {
      console.error('Zoho Books API error:', zohoData);
      return res.status(400).json({
        success: false,
        message: `Zoho Books error: ${zohoData.message || 'Unknown error'}`,
        details: zohoData
      });
    }

    // Compute applied_total and unused_amount using Zoho response when available
    const zohoPayment = zohoData.payment || {};
    const totalAllocatedRounded = Math.round(totalAllocated * 100) / 100;
    const appliedTotal = (typeof zohoPayment.applied_amount === 'number')
      ? Number(zohoPayment.applied_amount)
      : totalAllocatedRounded;
    const unusedAmount = (typeof zohoPayment.unused_amount === 'number')
      ? Number(zohoPayment.unused_amount)
      : Math.max(0, Math.round((paymentAmountNum - appliedTotal) * 100) / 100);

    // Create local payment record (mirror adjusted allocations to keep in sync with Zoho)
    const paymentData = {
      client: clientId,
      invoices: safeInvoices.map(inv => {
        const dbInvoice = dbInvoices.find(dbInv => dbInv._id.toString() === inv.invoiceId);
        const allowed = Number(allowedByLocalId.get(inv.invoiceId) || 0);
        const withheld = Number(withheldByLocalId.get(inv.invoiceId) || 0);
        return (allowed > 0.009 || withheld > 0.009) ? {
          invoice: inv.invoiceId,
          amount_applied: allowed,
          tax_deducted: inv.tax_deducted || false,
          tax_amount_withheld: withheld,
          zoho_invoice_id: dbInvoice?.zoho_invoice_id
        } : null;
      }).filter(Boolean),
      type: payment_mode,
      amount: paymentAmountNum,
      paymentDate: new Date(date),
      referenceNumber: reference_number,
      notes: description,
      currency: 'INR',
      applied_total: appliedTotal,
      unused_amount: unusedAmount,
      tax_amount_withheld_total: safeInvoices.reduce((s, inv) => s + (inv.tax_deducted ? Number(inv.tax_amount_withheld || 0) : 0), 0),
      
      // Zoho Books fields
      customer_id: client.zohoBooksContactId,
      zoho_payment_id: zohoData.payment?.payment_id,
      payment_number: zohoData.payment?.payment_number,
      zoho_status: zohoData.payment?.status,
      deposit_to_account_id,
      
      // Audit fields
      idempotency_key: idempotencyKey,
      raw_zoho_response: zohoData,
      source: 'zoho_books'
    };

    // Handle single invoice case (backward compatibility)
    if (safeInvoices.length === 1) {
      paymentData.invoice = safeInvoices[0].invoiceId;
    }

    const payment = await Payment.create(paymentData);

    // Update local invoice balances
    for (const inv of safeInvoices) {
      const allowed = Number(allowedByLocalId.get(inv.invoiceId) || 0);
      const withheld = Number(withheldByLocalId.get(inv.invoiceId) || 0);
      if (allowed > 0.009 || withheld > 0.009) {
        await updateInvoiceAfterZohoPayment(inv.invoiceId, allowed, withheld);
        try { if (allowed > 0.009) await applyPaymentToDeposit(inv.invoiceId, allowed); } catch (_) {}
      }
    }

    // If invoices belong to contracts, when all invoices for a contract are paid
    // mark contract.isfinalapproval = true so Final Approval toggle becomes available
    try {
      const contractIds = Array.from(new Set(dbInvoices
        .map(i => i.contract)
        .filter(Boolean)
        .map(id => id.toString())));

      for (const cId of contractIds) {
        const remaining = await Invoice.countDocuments({ contract: cId, status: { $ne: 'paid' } });
        if (remaining === 0) {
          // await Contract.findByIdAndUpdate(cId, { isfinalapproval: true }, { new: true });
          await logCRUDActivity(req, 'UPDATE', 'Contract', cId, null, {
            isfinalapproval: true,
            reason: 'All invoices paid'
          });
        }
      }
    } catch (flagErr) {
      // Non-blocking
    }

    // Increment client's extra_credits by the unused amount (excess payment)
    if (unusedAmount > 0) {
      try {
        await Client.findByIdAndUpdate(clientId, { $inc: { extra_credits: unusedAmount } });
      } catch (_) {}
    }

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_PROCESSED', 'Payment', payment._id, {
      zohoPaymentId: zohoData.payment?.payment_id,
      clientId,
      amount: paymentAmountNum,
      invoiceCount: safeInvoices.length,
      paymentMode: payment_mode,
      tax_amount_withheld_total: paymentData.tax_amount_withheld_total,
    });

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully in Zoho Books',
      data: {
        payment,
        zoho_response: zohoData
      }
    });

  } catch (error) {
    console.error('recordCustomerPayment error:', error);
    await logErrorActivity(req, error, 'Record Customer Payment');
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to record customer payment'
    });
  }
};

// GET /api/payments/zoho-customer-payments - List customer payments from Zoho Books
export const listCustomerPayments = async (req, res) => {
  try {
    const { customer_id, from, to, status, page = 1, per_page = 50 } = req.query;
    
    const accessToken = await getValidAccessToken();
    const orgId = getOrgId();

    if (!orgId) {
      return res.status(500).json({
        success: false,
        message: 'ZOHO_ORG_ID not configured'
      });
    }

    // Build query parameters
    const params = new URLSearchParams({
      organization_id: orgId,
      page: page.toString(),
      per_page: per_page.toString()
    });

    if (customer_id) params.append('customer_id', customer_id);
    if (from) params.append('date_start', from);
    if (to) params.append('date_end', to);
    if (status) params.append('filter_by', `Status.${status}`);

    const zohoUrl = `${getBooksBaseUrl()}/customerpayments?${params.toString()}`;
    const zohoResponse = await fetch(zohoUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const zohoData = await zohoResponse.json();

    if (!zohoResponse.ok) {
      console.error('Zoho Books API error:', zohoData);
      return res.status(400).json({
        success: false,
        message: `Zoho Books error: ${zohoData.message || 'Unknown error'}`,
        details: zohoData
      });
    }

    return res.json({
      success: true,
      data: zohoData
    });

  } catch (error) {
    console.error('listCustomerPayments error:', error);
    await logErrorActivity(req, error, 'List Customer Payments');
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list customer payments'
    });
  }
};

// Razorpay payment integration for day passes and meeting rooms
export const createRazorpayOrder = async (req, res) => {
  // Log incoming API call
  const requestId = await apiLogger.logIncomingWebhook({
    service: 'razorpay',
    operation: 'create_order',
    method: req.method || 'POST',
    url: req.originalUrl || req.url || '/api/payments/razorpay/create-order',
    headers: req.headers || {},
    requestBody: req.body,
    webhookSignature: null,
    webhookVerified: false,
    webhookEvent: 'create_razorpay_order',
    statusCode: 200,
    responseBody: { received: true },
    success: true,
    userAgent: req.headers['user-agent'] || null,
    ipAddress: (req.headers['x-forwarded-for'] || req.ip || '').toString()
  });

  try {
    const { dayPassId, bundleId, meetingBookingId } = req.body;

    if (!dayPassId && !bundleId && !meetingBookingId) {
      return res.status(400).json({ error: "Day pass ID, Bundle ID, or Meeting Booking ID is required" });
    }

    let item, amount, description, buildingName;

    if (dayPassId) {
      // Single day pass payment
      const dayPass = await DayPass.findById(dayPassId)
        .populate('building', 'name openSpacePricing')
        .populate('invoice', 'total');

      if (!dayPass) {
        return res.status(404).json({ error: "Day pass not found" });
      }

      if (dayPass.status !== 'payment_pending') {
        return res.status(400).json({ error: "Day pass is not pending payment" });
      }

      amount = dayPass.invoice?.total || dayPass.price;
      buildingName = dayPass.building?.name || "Workspace";
      description = `Day Pass - ${buildingName}`;
      item = { type: 'daypass', id: dayPassId };
    } else if (bundleId) {
      // Bundle payment
      const bundle = await DayPassBundle.findById(bundleId)
        .populate('building', 'name')
        .populate('invoice', 'total');

      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      if (bundle.status !== 'payment_pending') {
        return res.status(400).json({ error: "Bundle is not pending payment" });
      }

      amount = bundle.invoice?.total || bundle.totalAmount;
      buildingName = bundle.building?.name || "Workspace";
      description = `Day Pass Bundle - ${buildingName} (${bundle.no_of_dayPasses} passes)`;
      item = { type: 'bundle', id: bundleId };
    } else {
      // Meeting room booking payment
      const booking = await MeetingBooking.findById(meetingBookingId)
        .populate('room', 'name building')
        .populate('invoice', 'total')
        .populate({
          path: 'room',
          populate: {
            path: 'building',
            select: 'name'
          }
        });

      if (!booking) {
        return res.status(404).json({ error: "Meeting booking not found" });
      }

      if (booking.status !== 'payment_pending') {
        return res.status(400).json({ error: "Meeting booking is not pending payment" });
      }

      amount = booking.invoice?.total || booking.payment?.amount;
      buildingName = booking.room?.building?.name || "Meeting Room";
      const roomName = booking.room?.name || "Room";
      const startTime = new Date(booking.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const endTime = new Date(booking.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      description = `Meeting Room - ${roomName} (${startTime}-${endTime})`;
      item = { type: 'meeting', id: meetingBookingId };
    }
    
    const response = {
      success: true,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
      amount: amount * 100,
      currency: "INR",
      item,
      buildingName,
      description
    };

    await apiLogger.logWebhookResponse(requestId, 200, response, true);
    res.json(response);
  } catch (error) {
    console.error("createRazorpayOrder error:", error);
    await logErrorActivity(req, error, 'Create Razorpay Order');
    
    const errorResponse = { error: "Internal Server Error" };
    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, error.message);
    res.status(500).json(errorResponse);
  }
};

// Create a shareable Razorpay Payment Link for a meeting booking
export const createRazorpayPaymentLink = async (req, res) => {
  try {
    const { meetingBookingId } = req.body || {};

    if (!meetingBookingId) {
      return res.status(400).json({ success: false, message: 'meetingBookingId is required' });
    }

    const booking = await MeetingBooking.findById(meetingBookingId).populate('invoice');
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.discountStatus === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Discount approval pending; cannot generate payment link yet',
      });
    }

    if (booking.status !== 'payment_pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot generate payment link when booking status is ${booking.status}`,
      });
    }

    // Amount calculation
    let amount = 0;
    if (booking.invoice && typeof booking.invoice.total === 'number') {
      amount = Number(booking.invoice.total);
    } else {
      const dailyRate = booking.room?.pricing?.dailyRate || 500;
      const totals = computeInvoiceTotals(dailyRate, booking.appliedDiscountPercent || 0);
      amount = Number(totals.total);
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount for booking' });
    }

    // Razorpay-compliant payload
    const linkData = {
      amount: Math.round(amount * 100),
      currency: 'INR',
      description: `Meeting Room - ${booking.room?.name || 'Booking'}`,
      reference_id: `meeting_booking_${booking._id}`,
      notes: {
        type: 'meeting_booking',
        meetingBookingId: String(booking._id),
        ...(booking.invoice?._id && { invoiceId: String(booking.invoice._id) }),
      },
    };

    // OPTIONAL: add customer only if all values exist
    if (booking.customerName && booking.customerEmail && booking.customerPhone) {
      linkData.customer = {
        name: booking.customerName,
        email: booking.customerEmail,
        contact: booking.customerPhone,
      };
    }

    const result = await loggedRazorpay.createPaymentLink(linkData, {
      userId: req.user?.id || null,
      relatedEntity: 'MeetingBooking',
      relatedEntityId: String(booking._id),
    });

    return res.json({
      success: true,
      data: {
        id: result.id,
        short_url: result.short_url,
        status: result.status,
      },
    });
  } catch (error) {
    console.error('createRazorpayPaymentLink error:', error);
    await logErrorActivity(req, error, 'Create Razorpay Payment Link');

    const msg =
      (error?.message || '').toLowerCase().includes('authentication failed')
        ? 'Razorpay authentication failed. Please ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are configured on the server.'
        : error?.message || 'Failed to create payment link';

    return res.status(500).json({ success: false, message: msg });
  }
};


// Handle Razorpay payment success
export const handleRazorpaySuccess = async (req, res) => {
  // Log incoming API call
  const requestId = await apiLogger.logIncomingWebhook({
    service: 'razorpay',
    operation: 'payment_success',
    method: req.method || 'POST',
    url: req.originalUrl || req.url || '/api/payments/razorpay/success',
    headers: req.headers || {},
    requestBody: req.body,
    webhookSignature: null,
    webhookVerified: false,
    webhookEvent: 'razorpay_payment_success',
    statusCode: 200,
    responseBody: { received: true },
    success: true,
    userAgent: req.headers['user-agent'] || null,
    ipAddress: (req.headers['x-forwarded-for'] || req.ip || '').toString()
  });

  try {
    const { 
      razorpay_payment_id, 
      dayPassId,
      bundleId,
      meetingBookingId,
      amount,
      invoiceId,
      clientId
    } = req.body;

    if (!razorpay_payment_id || (!dayPassId && !bundleId && !meetingBookingId)) {
      return res.status(400).json({ error: "Payment ID and Day Pass ID, Bundle ID, or Meeting Booking ID are required" });
    }

    let item, customer, invoice, paymentNotes;

    if (dayPassId) {
      // Single day pass payment
      const dayPass = await DayPass.findById(dayPassId)
        .populate('invoice')
        .populate('customer');

      if (!dayPass) {
        return res.status(404).json({ error: "Day pass not found" });
      }

      item = dayPass;
      customer = dayPass.customer;
      invoice = dayPass.invoice;
      paymentNotes = `Razorpay payment for day pass ${dayPass._id}`;
    } else if (bundleId) {
      // Bundle payment
      const bundle = await DayPassBundle.findById(bundleId)
        .populate('invoice')
        .populate('customer');

      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      item = bundle;
      customer = bundle.customer;
      invoice = bundle.invoice;
      paymentNotes = `Razorpay payment for bundle ${bundle._id}`;
    } else {
      // Meeting room booking payment
      const booking = await MeetingBooking.findById(meetingBookingId)
        .populate('invoice')
        .populate({ path: 'member', select: 'firstName lastName email client' })
        .populate({ path: 'client', select: 'companyName zohoBooksContactId' });

      if (!booking) {
        return res.status(404).json({ error: "Meeting booking not found" });
      }

      // Resolve client via booking.client or booking.member.client
      let resolvedClient = booking.client;
      if (!resolvedClient && booking.member) {
        const memberDoc = await Member.findById(booking.member._id).populate('client');
        if (memberDoc?.client) {
          resolvedClient = memberDoc.client;
        }
      }

      item = booking;
      customer = resolvedClient || booking.member;
      invoice = booking.invoice;
      paymentNotes = `Razorpay payment for meeting booking ${booking._id}`;
    }

    // Determine customer type and set appropriate payment fields
    let paymentData = {
      invoice: invoice?._id || (invoiceId || undefined),
      type: "Razorpay",
      amount: amount / 100, // Convert from paise
      paymentDate: new Date(),
      referenceNumber: razorpay_payment_id,
      paymentGatewayRef: razorpay_payment_id,
      currency: "INR",
      notes: paymentNotes,
      source: "manual"
    };

    // Set client or guest based on customer type
    if (customer) {
      if (customer.constructor.modelName === 'Guest') {
        paymentData.guest = customer._id;
        // Guests don't have associated clients in the current schema
      }
      else if (customer.constructor.modelName === 'Member') {
        // For members, try to get associated client
        const member = await Member.findById(customer._id).populate('client');
        if (member?.client) {
          paymentData.client = member.client._id;
        }
      }
      else if (customer.constructor.modelName === 'Client') {
        paymentData.client = customer._id;
      }
    }

    // If clientId explicitly provided by frontend, ensure it is set
    if (clientId && !paymentData.client) {
      paymentData.client = clientId;
    }

    // Create payment record
    const payment = new Payment(paymentData);
    await payment.save();

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_PROCESSED', 'Payment', payment._id, {
      razorpayPaymentId: razorpay_payment_id,
      amount: amount / 100,
      itemType: dayPassId ? 'daypass' : (bundleId ? 'bundle' : 'meeting'),
      itemId: dayPassId || bundleId || meetingBookingId
    });

    // Update item status to issued/booked and create visitor records
    if (bundleId) {
      // For bundles, get all associated day passes and issue them
      const dayPasses = await DayPass.find({ bundle: bundleId });
      const dayPassIds = dayPasses.map(pass => pass._id.toString());
      
      // Issue all passes in the bundle (this will create visitor records)
      await issueDayPassBatch(dayPassIds);
      
      // Update bundle status
      item.status = "issued";
      await item.save();
    } else if (dayPassId) {
      // For single day pass, use the issuance service
      await issueDayPass(item._id);
    } else if (meetingBookingId) {
      // For meeting room booking, update status to booked
      item.status = "booked";
      await item.save();
    }

    // Convert paise to INR and floor to avoid rounding up (e.g., 2033.99 -> 2033)
    const paymentInrFloor = Math.floor(Number(amount) / 100);

    // If invoice not resolved from item but invoiceId was provided, fetch it now
    if (!invoice && invoiceId) {
      try {
        invoice = await Invoice.findById(invoiceId);
      } catch (_) {}
    }

    // Update invoice and push to Zoho for meeting bookings
    if (invoice) {
      // If this is a meeting booking flow, mirror day pass Zoho integration
      if (meetingBookingId) {
        try {
          // Re-fetch booking to get client linkage
          const bookingForZoho = await MeetingBooking.findById(meetingBookingId)
            .populate({ path: 'member', select: 'client' })
            .populate({ path: 'client', select: 'zohoBooksContactId companyName' })
            .populate('invoice');

          // Resolve client
          let clientForZoho = bookingForZoho?.client;
          if (!clientForZoho && bookingForZoho?.member) {
            const mem = await Member.findById(bookingForZoho.member._id).populate('client');
            clientForZoho = mem?.client || null;
          }

          if (clientForZoho && !bookingForZoho.invoice?.zoho_invoice_id) {
            await createInvoiceInZoho(bookingForZoho.invoice, clientForZoho);
          }

          // If we have client and a zoho invoice id, record customer payment in Zoho
          if (clientForZoho?.zohoBooksContactId && bookingForZoho.invoice?.zoho_invoice_id) {
            const accessToken = await getValidAccessToken();
            const orgId = getOrgId();
            const zohoUrl = `${getBooksBaseUrl()}/customerpayments?organization_id=${orgId}`;
            const zohoPayload = {
              customer_id: clientForZoho.zohoBooksContactId,
              payment_mode: 'Razorpay',
              amount: paymentInrFloor,
              date: new Date().toISOString().slice(0,10),
              invoices: [{ invoice_id: bookingForZoho.invoice.zoho_invoice_id, amount_applied: paymentInrFloor }],
              reference_number: razorpay_payment_id,
              description: paymentNotes
            };

            const zohoResp = await fetch(zohoUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(zohoPayload)
            });

            const zohoData = await zohoResp.json();
            if (zohoResp.ok) {
              // Update local payment with Zoho details
              payment.zoho_payment_id = zohoData.payment?.payment_id;
              payment.payment_number = zohoData.payment?.payment_number;
              payment.zoho_status = zohoData.payment?.status;
              payment.raw_zoho_response = zohoData;
              payment.source = 'zoho_books';
              await payment.save();
              // Apply locally now with the same floored amount
              await applyInvoicePayment(invoice._id, paymentInrFloor);
            } else {
              console.error('Zoho customer payment failed for meeting booking:', zohoData);
              // Even if Zoho fails, apply locally to reflect Razorpay success
              await applyInvoicePayment(invoice._id, paymentInrFloor);
            }
          }
        } catch (zohoErr) {
          console.error('Meeting booking Zoho sync error:', zohoErr);
          // On error, still apply locally
          await applyInvoicePayment(invoice._id, paymentInrFloor);
        }
      }

      // If this is a day pass or bundle payment, sync to Zoho Books similarly
      if (dayPassId || bundleId) {
        // Track whether we applied locally during Zoho success to avoid double-applying later
        let appliedViaZohoSuccess = false;
        
        try {
          // Re-fetch day pass or bundle with customer and invoice populated
          let itemForZoho = null;
          let clientForZoho = null;
          if (dayPassId) {
            itemForZoho = await DayPass.findById(dayPassId)
              .populate({ path: 'customer', select: 'client zohoBooksContactId', options: { strictPopulate: false } })
              .populate('invoice');
          } else if (bundleId) {
            itemForZoho = await DayPassBundle.findById(bundleId)
              .populate({ path: 'customer', select: 'client zohoBooksContactId', options: { strictPopulate: false } })
              .populate('invoice');
          }

          // Resolve client depending on customer type
          // Customer could be Guest, Member, or Client
          if (itemForZoho?.customer) {
            const ctor = itemForZoho.customer.constructor?.modelName;
            if (ctor === 'Client') {
              clientForZoho = itemForZoho.customer;
            } else if (ctor === 'Member') {
              const mem = await Member.findById(itemForZoho.customer._id).populate('client');
              clientForZoho = mem?.client || null;
            } else if (ctor === 'Guest') {
              // Guests have no direct Zoho linkage; skip Zoho sync for guest-only purchases
              clientForZoho = null;
            }
          }

          // Create invoice in Zoho if linked client exists and no zoho invoice yet
          if (clientForZoho && itemForZoho?.invoice && !itemForZoho.invoice.zoho_invoice_id) {
            await createInvoiceInZoho(itemForZoho.invoice, clientForZoho);
          }


          // Record customer payment in Zoho if client is linked and invoice exists in Zoho
          if (clientForZoho?.zohoBooksContactId && itemForZoho?.invoice?.zoho_invoice_id) {
            const accessToken = await getValidAccessToken();
            const orgId = getOrgId();
            const zohoUrl = `${getBooksBaseUrl()}/customerpayments?organization_id=${orgId}`;
            const zohoPayload = {
              customer_id: clientForZoho.zohoBooksContactId,
              payment_mode: 'Razorpay',
              amount: paymentInrFloor,
              date: new Date().toISOString().slice(0,10),
              invoices: [{ invoice_id: itemForZoho.invoice.zoho_invoice_id, amount_applied: paymentInrFloor }],
              reference_number: razorpay_payment_id,
              description: paymentNotes
            };

            const zohoResp = await fetch(zohoUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(zohoPayload)
            });

            const zohoData = await zohoResp.json();
            if (zohoResp.ok) {
              payment.zoho_payment_id = zohoData.payment?.payment_id;
              payment.payment_number = zohoData.payment?.payment_number;
              payment.zoho_status = zohoData.payment?.status;
              payment.raw_zoho_response = zohoData;
              payment.source = 'zoho_books';
              await payment.save();
              await applyInvoicePayment(invoice._id, paymentInrFloor);
              appliedViaZohoSuccess = true;
            } else {
              console.error('Zoho customer payment failed for day pass/bundle:', zohoData);
              // Apply locally even if Zoho fails
              await applyInvoicePayment(invoice._id, paymentInrFloor);
            }
          }
        } catch (zohoErr) {
          console.error('Day pass/bundle Zoho sync error:', zohoErr);
          // Apply locally on error
          await applyInvoicePayment(invoice._id, paymentInrFloor);
        }
        
        // Only apply locally if we didn't already apply via Zoho success
        if (invoice && !appliedViaZohoSuccess) {
          await applyInvoicePayment(invoice._id, paymentInrFloor);
        }
      }
    }

    const responseMessage = dayPassId 
      ? "Payment successful, day pass issued"
      : (bundleId ? "Payment successful, bundle and day passes issued" : "Payment successful, meeting room booked");

    const response = {
      success: true,
      message: responseMessage,
      item,
      payment: {
        id: payment._id,
        razorpay_payment_id,
        amount: payment.amount,
        status: "completed"
      }
    };

    await apiLogger.logWebhookResponse(requestId, 200, response, true);
    res.json(response);
  } catch (error) {
    console.error("handleRazorpaySuccess error:", error);
    console.error("Error stack:", error.stack);
    await logErrorActivity(req, error, 'Handle Razorpay Success');
    
    const errorResponse = { 
      error: "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };
    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, error.message);
    res.status(500).json(errorResponse);
  }
};

// Razorpay webhook handler for payment status updates
export const handleRazorpayWebhook = async (req, res) => {
  // Determine raw Buffer for signature verification
  const rawBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(
        typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body || {}),
        'utf8'
      );
 
   // Proper logging call using options object
   const logEntry = await apiLogger.logIncomingWebhook({
     service: 'razorpay',
     operation: 'payment_webhook',
     method: (req.method || 'POST').toUpperCase(),
     url: req.originalUrl || req.url || '/api/payments/razorpay/webhook',
     headers: req.headers || {},
     requestBody: (() => { try { return JSON.parse(rawBuffer.toString('utf8')); } catch { return rawBuffer.toString('utf8'); } })(),
     webhookSignature: req.headers['x-razorpay-signature'] || '',
     webhookVerified: false,
     webhookEvent: undefined,
     statusCode: 200,
     responseBody: { received: true },
     success: true,
     userAgent: req.headers['user-agent'] || null,
     ipAddress: (req.headers['x-forwarded-for'] || req.ip || '').toString()
   });
 
   const requestId = (logEntry && typeof logEntry === 'object') ? (logEntry.requestId || logEntry._id || '') : String(logEntry || '');
 
   try {
     const parsed = (() => { try { return JSON.parse(rawBuffer.toString('utf8')); } catch { return req.body || {}; } })();
     const { event, payload } = parsed || {};
     
     // Verify signature using exact raw payload
     const signature = req.headers['x-razorpay-signature'] || '';
     const isValidSignature = await loggedRazorpay.verifyWebhookSignature(rawBuffer, signature);
     
     if (!isValidSignature) {
       const errorResponse = { error: 'Invalid webhook signature' };
       await apiLogger.logWebhookResponse(requestId, 401, errorResponse, false, 'Invalid signature', {
         webhookVerified: false,
         webhookEvent: event || null
       });
       return res.status(401).json(errorResponse);
     }
     
     console.log('Razorpay webhook received:', event);
     
     if (event === 'payment.captured' || event === 'payment.authorized') {
       const paymentId = payload?.payment?.entity?.id;
       const amount = payload?.payment?.entity?.amount;
       
       if (paymentId && amount) {
         console.log('Webhook payment details:', {
           paymentId,
           amount: amount / 100,
           status: payload?.payment?.entity?.status
         });
         
         // TODO: Implement automatic day pass status update based on payment ID
         // This would require storing payment ID during order creation
       }
     }
     
     if (event && payload) {
       try {
         // Handle Payment Link success
         if (String(event).startsWith('payment_link.')) {
           const pl = payload?.payment_link?.entity;
           if (pl && pl.status === 'paid') {
             const notes = pl.notes || {};
             const ref = pl.reference_id || '';
             const isMeeting = notes?.type === 'meeting_booking' || String(ref).startsWith('meeting_booking_');
             const bookingId = notes?.meetingBookingId || String(ref).replace('meeting_booking_', '');
             const invoiceId = notes?.invoiceId;
             const amount = (typeof pl.amount === 'number' ? pl.amount : pl.amount_paid) || 0; // in paise
          
             if (isMeeting && bookingId) {
               const booking = await MeetingBooking.findById(bookingId).populate('invoice');
               if (booking) {
               // Record payment against invoice and create Payment (idempotent)
const paidAmountInr = Math.round(Number(amount || 0)) / 100;
const rzpPaymentId = payload?.payment?.entity?.id || pl?.id || null;

if (booking.invoice?._id && paidAmountInr > 0) {
  // 1) Idempotency: avoid duplicate Payment for the same Razorpay payment id
  let existing = null;
  if (rzpPaymentId) {
    existing = await Payment.findOne({ paymentGatewayRef: rzpPaymentId });
  }

  // 2) Create local Payment if not existing
  let paymentDoc = existing;
  if (!paymentDoc) {
    try {
      paymentDoc = await Payment.create({
        invoice: booking.invoice._id,
        client: booking.client || undefined,
        type: 'Razorpay',
        paymentGatewayRef: rzpPaymentId || undefined,
        amount: paidAmountInr,
        paymentDate: new Date(),
        currency: 'INR',
        notes: `Razorpay ${event} • meeting_booking:${bookingId}`,
        source: 'webhook'
      });
    } catch (pcErr) {
      console.error('Failed to create local Payment from webhook:', pcErr?.message || pcErr);
    }
  }

  // 3) Update local invoice totals/status
  try { await applyInvoicePayment(booking.invoice._id, paidAmountInr); } catch (_) {}

  // 4) Zoho push: ensure Zoho invoice exists, then record a Customer Payment
  try {
    // Load client to access zohoBooksContactId
    const clientDoc = booking.client ? await Client.findById(booking.client) : null;
    if (clientDoc?.zohoBooksContactId) {
      // Create Zoho invoice if missing
      if (!booking.invoice.zoho_invoice_id) {
        try {
          const created = await createZohoInvoiceFromLocal(booking.invoice.toObject(), clientDoc.toObject());
          const inv = created?.invoice || created;
          if (inv?.invoice_id) {
            booking.invoice.zoho_invoice_id = inv.invoice_id;
            booking.invoice.zoho_invoice_number = inv.invoice_number;
            booking.invoice.zoho_status = inv.status || inv.status_formatted;
            booking.invoice.zoho_pdf_url = inv.pdf_url;
            booking.invoice.invoice_url = inv.invoice_url;
            await booking.invoice.save();
          }
        } catch (e) {
          console.warn('Zoho invoice creation failed (webhook path):', e?.message || e);
        }
      }

      // Record customer payment in Zoho
      if (booking.invoice.zoho_invoice_id) {
        try {
          const zohoPayload = {
            customer_id: clientDoc.zohoBooksContactId,
            payment_mode: 'Razorpay',
            amount: paidAmountInr,
            date: new Date().toISOString().slice(0,10),
            invoices: [{ invoice_id: booking.invoice.zoho_invoice_id, amount_applied: paidAmountInr }],
            reference_number: rzpPaymentId || pl?.id,
            description: `Meeting booking payment (${bookingId})`
          };

          const zohoResp = await recordZohoPayment(booking.invoice.zoho_invoice_id, zohoPayload);
          const zp = zohoResp?.payment || zohoResp;
          if (paymentDoc && zp?.payment_id) {
            paymentDoc.zoho_payment_id = zp.payment_id;
            paymentDoc.payment_number = zp.payment_number;
            paymentDoc.zoho_status = zp.status;
            paymentDoc.raw_zoho_response = zohoResp;
            paymentDoc.source = 'zoho_books';
            await paymentDoc.save();
          }
        } catch (ze) {
          console.error('Zoho payment record failed (webhook path):', ze?.message || ze);
        }
      }
    }
  } catch (syncErr) {
    console.error('Webhook Zoho sync error:', syncErr?.message || syncErr);
  }
}
                 // Update booking status to booked if payment was pending
                 if (booking.status === 'payment_pending') {
                   booking.status = 'booked';
                   await booking.save();
                 }
               }
             }
           }
         }
       } catch (eh) {
         console.error('Webhook post-processing error:', eh);
       }
     }
     
     const response = { status: 'received' };
     await apiLogger.logWebhookResponse(requestId, 200, response, true, null, {
       webhookVerified: true,
       webhookEvent: event || null
     });
     
     res.status(200).json(response);
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    await logErrorActivity(req, error, 'Razorpay Webhook');
     
    const errorResponse = { error: 'Webhook processing failed' };
    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, error.message, {
      webhookVerified: false,
      webhookEvent: event || null
    });
     
    res.status(500).json(errorResponse);
  }
};

// Credit-based payment for day passes
export const payWithCredits = async (req, res) => {
  try {
    const { dayPassId, bundleId, memberId, clientId } = req.body;

    if (!memberId && !clientId) {
      return res.status(400).json({ error: "Member ID or Client ID is required for credit payments" });
    }

    if (!dayPassId && !bundleId) {
      return res.status(400).json({ error: "Day pass ID or Bundle ID is required" });
    }

    let member, finalClientId;

    if (memberId) {
      // Direct member access
      member = await Member.findById(memberId).populate('client');
      if (!member || !member.client) {
        return res.status(404).json({ error: "Member or associated client not found" });
      }
      finalClientId = member.client._id;
    } else {
      // Find member using client ID or client's phone
      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      // Find member associated with this client using phone number
      member = await Member.findOne({ 
        $or: [
          { client: clientId },
          { phone: client.phone }
        ]
      }).populate('client');

      if (!member) {
        return res.status(404).json({ 
          error: "No member found associated with this client. Member account required for credit payments." 
        });
      }
      finalClientId = clientId;
    }

    // Check if client has active credit-enabled contract
    const contract = await Contract.findOne({
      client: finalClientId,
      credit_enabled: true,
      status: "active"
    });

    if (!contract) {
      return res.status(400).json({ 
        error: "No active credit-enabled contract found for this client" 
      });
    }

    // Get credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: finalClientId });
    const currentBalance = wallet?.balance || 0;
    const creditValue = contract.credit_value || 500;

    let item, totalAmount, creditsRequired;

    if (dayPassId) {
      // Single day pass
      const dayPass = await DayPass.findById(dayPassId)
        .populate('building', 'openSpacePricing')
        .populate('invoice', 'total');

      if (!dayPass) {
        return res.status(404).json({ error: "Day pass not found" });
      }

      if (dayPass.status !== 'payment_pending') {
        return res.status(400).json({ error: "Day pass is not pending payment" });
      }

      totalAmount = dayPass.invoice?.total || dayPass.price;
      creditsRequired = Math.ceil(totalAmount / creditValue);
      item = dayPass;
    } else {
      // Bundle
      const bundle = await DayPassBundle.findById(bundleId)
        .populate('building', 'name')
        .populate('invoice', 'total');

      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      if (bundle.status !== 'payment_pending') {
        return res.status(400).json({ error: "Bundle is not pending payment" });
      }

      totalAmount = bundle.invoice?.total || bundle.totalAmount;
      creditsRequired = Math.ceil(totalAmount / creditValue);
      item = bundle;
    }

    // Check if sufficient credits
    if (currentBalance < creditsRequired) {
      return res.status(400).json({ 
        error: "Insufficient credits",
        required: creditsRequired,
        available: currentBalance,
        shortfall: creditsRequired - currentBalance
      });
    }

    const balanceAfter = currentBalance - creditsRequired;

    // Create CreditTransaction record for the usage
    const creditTransaction = new CreditTransaction({
      clientId: finalClientId,
      contractId: contract._id,
      itemSnapshot: {
        name: dayPassId ? "Day Pass" : "Day Pass Bundle",
        unit: "pass",
        pricingMode: "credits",
        unitCredits: dayPassId ? creditsRequired : creditsRequired / item.no_of_dayPasses,
        taxable: true,
        gstRate: 18
      },
      quantity: dayPassId ? 1 : item.no_of_dayPasses,
      transactionType: "usage",
      pricingSnapshot: {
        pricingMode: "credits",
        unitCredits: dayPassId ? creditsRequired : creditsRequired / item.no_of_dayPasses,
        creditValueINR: creditValue
      },
      creditsDelta: -creditsRequired, // Negative for usage
      amountINRDelta: -totalAmount, // Negative for usage
      purpose: dayPassId ? "Day pass purchase" : "Day pass bundle purchase",
      description: `Credit payment for ${dayPassId ? 'day pass' : 'bundle'} - ${creditsRequired} credits used`,
      status: "completed",
      createdBy: req.user?._id || member._id, // Use authenticated user or member as fallback
      metadata: {
        dayPassId: dayPassId || null,
        bookingId: bundleId || null,
        customData: {
          paymentMethod: "credits",
          originalAmount: totalAmount,
          creditsUsed: creditsRequired
        }
      }
    });

    await creditTransaction.save();

    // Update wallet balance
    await ClientCreditWallet.findOneAndUpdate(
      { client: finalClientId },
      { 
        $inc: { balance: -creditsRequired },
        $set: { 
          creditValue: creditValue,
          status: "active"
        }
      },
      { upsert: true }
    );

    // Update item status to issued and create visitor records
    if (bundleId) {
      // For bundles, get all associated day passes and issue them
      const dayPasses = await DayPass.find({ bundle: bundleId });
      const dayPassIds = dayPasses.map(pass => pass._id.toString());
      
      // Issue all passes in the bundle (this will create visitor records)
      await issueDayPassBatch(dayPassIds);
      
      // Update bundle status
      item.status = "issued";
      await item.save();
    } else {
      // For single day pass, use the issuance service
      await issueDayPass(item._id);
    }

    // Create payment record for tracking
    const payment = new Payment({
      invoice: item.invoice,
      client: finalClientId,
      type: "Credits",
      amount: totalAmount,
      paymentDate: new Date(),
      referenceNumber: `CRED-${Date.now()}`,
      currency: "INR",
      notes: `Credit payment - ${creditsRequired} credits used`,
      source: "manual"
    });

    await payment.save();

    // Update invoice if exists
    if (item.invoice) {
      await applyInvoicePayment(item.invoice._id, totalAmount);
    }

    const responseMessage = dayPassId 
      ? "Day pass purchased successfully with credits"
      : "Bundle purchased successfully with credits";

    res.json({
      success: true,
      message: responseMessage,
      transaction: {
        creditsUsed: creditsRequired,
        amount: totalAmount,
        balanceAfter
      },
      item,
      payment: {
        id: payment._id,
        amount: payment.amount,
        status: "completed"
      }
    });

  } catch (error) {
    console.error("payWithCredits error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get member's credit balance
export const getMemberCreditBalance = async (req, res) => {
  try {
    const { memberId } = req.params;

    // Find member and get associated client
    const member = await Member.findById(memberId).populate('client');
    if (!member || !member.client) {
      return res.status(404).json({ error: "Member or associated client not found" });
    }

    const clientId = member.client._id;

    // Check if client has active credit-enabled contract
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    });

    if (!contract) {
      return res.json({
        success: true,
        creditEnabled: false,
        balance: 0,
        creditValue: 0,
        message: "No active credit-enabled contract found"
      });
    }

    // Get credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    const balance = wallet?.balance || 0;
    
    // Get creditValue from building instead of contract
    const building = contract.building;
    const creditValue = building?.creditValue || 500;

    res.json({
      success: true,
      creditEnabled: true,
      balance,
      creditValue,
      balanceINR: balance * creditValue,
      client: {
        id: clientId,
        name: member.client.companyName
      }
    });

  } catch (error) {
    console.error("getMemberCreditBalance error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get client's credit balance directly
export const getClientCreditBalance = async (req, res) => {
  try {
    const { clientId } = req.params;

    // Find client
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Check if client has active credit-enabled contract
    const contract = await Contract.findOne({
      client: clientId,
      credit_enabled: true,
      status: "active"
    }).populate('building');

    if (!contract) {
      return res.json({
        success: true,
        creditEnabled: false,
        balance: 0,
        creditValue: 0,
        message: "No active credit-enabled contract found"
      });
    }

    // Get credit wallet
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    const balance = wallet?.balance || 0;
    
    // Get creditValue from building instead of contract
    const building = contract.building;
    const creditValue = building?.creditValue || 500;

    res.json({
      success: true,
      creditEnabled: true,
      balance,
      creditValue,
      balanceINR: balance * creditValue,
      client: {
        id: clientId,
        name: client.companyName || client.contactPerson
      }
    });

  } catch (error) {
    console.error("getClientCreditBalance error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const refundExcessPayment = async (req, res) => {
  try {
    const { id } = req.params; // local Payment _id
    const { amount, date, mode, reference_number, notes } = req.body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "amount must be > 0" });
    }

    const payment = await Payment.findById(id).populate("client");
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (!payment.zoho_payment_id) return res.status(400).json({ success: false, message: "Payment not synced to Zoho yet" });

    const refundAmount = Number(amount);
    if (refundAmount > Number(payment.unused_amount || 0)) {
      return res.status(400).json({ success: false, message: `Refund amount (${refundAmount}) exceeds unused amount (${payment.unused_amount || 0})` });
    }

    // Refund via Zoho Books
    const refundPayload = {
      amount: refundAmount,
      date: date ? new Date(date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
      mode: mode || "BankTransfer",
      reference_number: reference_number || undefined,
      description: notes || undefined,
    };

    const zohoRefund = await refundZohoExcessPayment(payment.zoho_payment_id, refundPayload);

    // Update local payment and client extra_credits
    payment.unused_amount = Math.max(0, Math.round(((payment.unused_amount || 0) - refundAmount) * 100) / 100);
    payment.refunds = payment.refunds || [];
    payment.refunds.push({
      amount: refundAmount,
      date: date ? new Date(date) : new Date(),
      mode: refundPayload.mode,
      reference_number: refundPayload.reference_number,
      zoho_refund_id: zohoRefund?.refund?.refund_id || undefined,
      notes: notes || undefined,
    });
    await payment.save();

    if (payment.client?._id) {
      try { await Client.findByIdAndUpdate(payment.client._id, { $inc: { extra_credits: -refundAmount } }); } catch (_) {}
    }

    await logPaymentActivity(req, 'PAYMENT_REFUND', 'Payment', payment._id, {
      refundAmount,
      zohoPaymentId: payment.zoho_payment_id,
      zohoRefundId: zohoRefund?.refund?.refund_id,
    });

    return res.json({ success: true, data: { payment, zoho_refund: zohoRefund } });
  } catch (error) {
    await logErrorActivity(req, error, 'Refund Excess Payment');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const applyExcessPaymentToInvoice = async (req, res) => {
  try {
    const { id } = req.params; // local Payment _id
    const { invoiceId, amount } = req.body || {};

    if (!invoiceId) return res.status(400).json({ success: false, message: "invoiceId is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount must be > 0" });

    const allocAmount = Math.round(Number(amount) * 100) / 100;

    const payment = await Payment.findById(id).populate("client");
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    if (!payment.zoho_payment_id) return res.status(400).json({ success: false, message: "Payment not synced to Zoho yet" });

    if (allocAmount > Number(payment.unused_amount || 0)) {
      return res.status(400).json({ success: false, message: `Allocation amount (${allocAmount}) exceeds payment unused amount (${payment.unused_amount || 0})` });
    }

    const invoice = await Invoice.findById(invoiceId).populate('client');
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Ensure invoice belongs to same client (handle populated or ObjectId refs)
    const invoiceClientId = invoice?.client?._id
      ? invoice.client._id.toString()
      : (invoice?.client && typeof invoice.client.toString === 'function' ? invoice.client.toString() : null);
    const paymentClientId = payment?.client?._id
      ? payment.client._id.toString()
      : (payment?.client && typeof payment.client.toString === 'function' ? payment.client.toString() : null);
    if (invoiceClientId && paymentClientId && invoiceClientId !== paymentClientId) {
      return res.status(400).json({ success: false, message: "Invoice does not belong to the payment's client" });
    }

    // Ensure Zoho invoice exists
    let zohoInvoiceId = invoice.zoho_invoice_id;
    if (!zohoInvoiceId) {
      return res.status(400).json({ success: false, message: "Invoice is not synced to Zoho. Please sync the invoice to Zoho before applying credits." });
    }

    // Determine outstanding using both local and Zoho (cap by Zoho's live balance)
    const localOutstanding = Number(invoice.balance || invoice.total || 0);
    let zohoOutstanding = localOutstanding;
    try {
      const zohoInv = await getZohoInvoice(zohoInvoiceId);
      zohoOutstanding = Number(
        (zohoInv && (zohoInv.balance || zohoInv.balance_due || zohoInv.outstanding)) ?? 0
      );
    } catch (_) {}

    let need = Math.max(0, Math.min(localOutstanding, zohoOutstanding));
    if (need < 0.01) {
      return res.json({ success: true, data: { invoiceId, allocated: 0, leftover: 0, allocations: [] } });
    }

    // Find all client payments with unused_amount > 0 (FIFO)
    const payments = await Payment.find({ client: paymentClientId, unused_amount: { $gt: 0 } }).sort({ createdAt: 1 });

    let totalAllocated = 0;
    const allocations = [];

    for (const pay of payments) {
      if (need < 0.01) break;
      const payUnused = Number(pay.unused_amount || 0);
      if (payUnused <= 0.009) continue;
      if (!pay.zoho_payment_id) continue; // only apply from Zoho-synced payments

      // Fetch current Zoho payment allocations
      let existingAllocations = [];
      try {
        const zohoPayment = await getZohoCustomerPayment(pay.zoho_payment_id);
        existingAllocations = (zohoPayment?.invoices || zohoPayment?.invoice_payments || []).map(ip => ({
          invoice_id: ip.invoice_id,
          amount_applied: Number(ip.amount_applied || ip.applied_amount || 0)
        }));
      } catch (_) {}

      const alloc = Math.min(need, payUnused);
      if (alloc <= 0.009) continue;

      // Only update the selected invoice in Zoho payload (do not include other invoices)
      const prevForTarget = (existingAllocations.find(a => a.invoice_id === zohoInvoiceId)?.amount_applied) || 0;
      const newInvoices = [{ invoice_id: zohoInvoiceId, amount_applied: Math.round((prevForTarget + alloc) * 100) / 100 }];

      // Debug: log the payload that will be sent to Zoho
      try {
        console.log('[applyExcessPaymentToInvoice] payment:', pay.zoho_payment_id);
        console.log('[applyExcessPaymentToInvoice] PUT payload:', JSON.stringify({ invoices: newInvoices }, null, 2));
      } catch (_) {}

      // Update Zoho payment allocations
      await updateZohoCustomerPayment(pay.zoho_payment_id, { invoices: newInvoices });

      // Update local payment aggregates and attach invoice allocation line
      pay.applied_total = Math.round(((Number(pay.applied_total || 0) + alloc)) * 100) / 100;
      pay.unused_amount = Math.max(0, Math.round(((Number(pay.unused_amount || 0) - alloc)) * 100) / 100);
      try {
        const invIdStr = invoiceId.toString();
        const existing = pay.invoices?.find?.((pi) => {
          const piId = (pi?.invoice && typeof pi.invoice.toString === 'function') ? pi.invoice.toString() : String(pi?.invoice || '');
          return piId === invIdStr;
        });
        if (existing) {
          existing.amount_applied = Math.round((Number(existing.amount_applied || 0) + alloc) * 100) / 100;
          if (!existing.zoho_invoice_id) existing.zoho_invoice_id = zohoInvoiceId;
        } else {
          pay.invoices = pay.invoices || [];
          pay.invoices.push({ invoice: invoiceId, amount_applied: alloc, zoho_invoice_id: zohoInvoiceId });
        }
      } catch (_) {}
      await pay.save();

      // Update client extra_credits down by alloc
      try { await Client.findByIdAndUpdate(paymentClientId, { $inc: { extra_credits: -alloc } }); } catch (_) {}

      // Update local invoice
      await updateInvoiceAfterZohoPayment(invoiceId, alloc);
      try { await applyPaymentToDeposit(invoiceId, alloc); } catch (_) {}

      totalAllocated = Math.round((totalAllocated + alloc) * 100) / 100;
      need = Math.max(0, Math.round((need - alloc) * 100) / 100);
      allocations.push({ paymentId: String(pay._id), zoho_payment_id: pay.zoho_payment_id, allocated: alloc });

      // Activity log
      try {
        await logPaymentActivity(req, 'PAYMENT_ALLOCATION', 'Payment', pay._id, {
          allocatedToInvoiceId: invoiceId,
          allocatedAmount: alloc,
          zohoPaymentId: pay.zoho_payment_id,
          zohoInvoiceId,
          mode: 'apply_all_credits'
        });
      } catch (_) {}
    }

    const leftover = Math.max(0, Math.round(need * 100) / 100);
    return res.json({ success: true, data: { invoiceId, allocated: totalAllocated, leftover, allocations } });

  } catch (error) {
    await logErrorActivity(req, error, 'Apply Excess Payment to Invoice');
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/payments/credits/apply-to-invoice
// Body: { clientId, invoiceId }
export const applyAllCreditsToInvoice = async (req, res) => {
  try {
    const { clientId, invoiceId } = req.body || {};

    if (!clientId) return res.status(400).json({ success: false, message: 'clientId is required' });
    if (!invoiceId) return res.status(400).json({ success: false, message: 'invoiceId is required' });

    const invoice = await Invoice.findById(invoiceId).populate('client');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    const invClientId = invoice?.client?._id ? String(invoice.client._id) : String(invoice.client);
    if (String(invClientId) !== String(clientId)) {
      return res.status(400).json({ success: false, message: 'Invoice does not belong to the provided client' });
    }

    const zohoInvoiceId = invoice.zoho_invoice_id;
    if (!zohoInvoiceId) {
      return res.status(400).json({ success: false, message: 'Invoice is not synced to Zoho. Please sync the invoice to Zoho before applying credits.' });
    }

    // Determine outstanding using both local and Zoho (cap by Zoho's live balance)
    const localOutstanding = Number(invoice.balance || invoice.total || 0);
    let zohoOutstanding = localOutstanding;
    try {
      const zohoInv = await getZohoInvoice(zohoInvoiceId);
      zohoOutstanding = Number(
        (zohoInv && (zohoInv.balance || zohoInv.balance_due || zohoInv.outstanding)) ?? 0
      );
    } catch (_) {}

    let need = Math.max(0, Math.min(localOutstanding, zohoOutstanding));
    if (need < 0.01) {
      return res.json({ success: true, data: { invoiceId, allocated: 0, leftover: 0, allocations: [] } });
    }

    // Find all client payments with unused_amount > 0 (FIFO)
    const payments = await Payment.find({ client: clientId, unused_amount: { $gt: 0 } }).sort({ createdAt: 1 });

    let totalAllocated = 0;
    const allocations = [];

    for (const pay of payments) {
      if (need < 0.01) break;
      const payUnused = Number(pay.unused_amount || 0);
      if (payUnused <= 0.009) continue;
      if (!pay.zoho_payment_id) continue; // only apply from Zoho-synced payments

      // Fetch current Zoho payment allocations
      let existingAllocations = [];
      try {
        const zohoPayment = await getZohoCustomerPayment(pay.zoho_payment_id);
        existingAllocations = (zohoPayment?.invoices || zohoPayment?.invoice_payments || []).map(ip => ({
          invoice_id: ip.invoice_id,
          amount_applied: Number(ip.amount_applied || ip.applied_amount || 0)
        }));
      } catch (_) {}

      const alloc = Math.min(need, payUnused);
      if (alloc <= 0.009) continue;

      // Only update the selected invoice in Zoho payload (do not include other invoices)
      const prevForTarget = (existingAllocations.find(a => a.invoice_id === zohoInvoiceId)?.amount_applied) || 0;
      const newInvoices = [{ invoice_id: zohoInvoiceId, amount_applied: Math.round((prevForTarget + alloc) * 100) / 100 }];

      // Debug: log the payload that will be sent to Zoho
      try {
        console.log('[applyAllCreditsToInvoice] payment:', pay.zoho_payment_id);
        console.log('[applyAllCreditsToInvoice] PUT payload:', JSON.stringify({ invoices: newInvoices }, null, 2));
      } catch (_) {}

      // Update Zoho payment allocations
      await updateZohoCustomerPayment(pay.zoho_payment_id, { invoices: newInvoices });

      // Update local payment aggregates and attach invoice allocation line
      pay.applied_total = Math.round(((Number(pay.applied_total || 0) + alloc)) * 100) / 100;
      pay.unused_amount = Math.max(0, Math.round(((Number(pay.unused_amount || 0) - alloc)) * 100) / 100);
      try {
        const invIdStr = invoiceId.toString();
        const existing = pay.invoices?.find?.((pi) => {
          const piId = (pi?.invoice && typeof pi.invoice.toString === 'function') ? pi.invoice.toString() : String(pi?.invoice || '');
          return piId === invIdStr;
        });
        if (existing) {
          existing.amount_applied = Math.round((Number(existing.amount_applied || 0) + alloc) * 100) / 100;
          if (!existing.zoho_invoice_id) existing.zoho_invoice_id = zohoInvoiceId;
        } else {
          pay.invoices = pay.invoices || [];
          pay.invoices.push({ invoice: invoiceId, amount_applied: alloc, zoho_invoice_id: zohoInvoiceId });
        }
      } catch (_) {}
      await pay.save();

      // Update client extra_credits down by alloc
      try { await Client.findByIdAndUpdate(clientId, { $inc: { extra_credits: -alloc } }); } catch (_) {}

      // Update local invoice
      await updateInvoiceAfterZohoPayment(invoiceId, alloc);
      try { await applyPaymentToDeposit(invoiceId, alloc); } catch (_) {}

      totalAllocated = Math.round((totalAllocated + alloc) * 100) / 100;
      need = Math.max(0, Math.round((need - alloc) * 100) / 100);
      allocations.push({ paymentId: String(pay._id), zoho_payment_id: pay.zoho_payment_id, allocated: alloc });

      // Activity log
      try {
        await logPaymentActivity(req, 'PAYMENT_ALLOCATION', 'Payment', pay._id, {
          allocatedToInvoiceId: invoiceId,
          allocatedAmount: alloc,
          zohoPaymentId: pay.zoho_payment_id,
          zohoInvoiceId,
          mode: 'apply_all_credits'
        });
      } catch (_) {}
    }

    const leftover = Math.max(0, Math.round(need * 100) / 100);
    return res.json({ success: true, data: { invoiceId, allocated: totalAllocated, leftover, allocations } });

  } catch (error) {
    await logErrorActivity(req, error, 'Apply All Credits to Invoice');
    return res.status(500).json({ success: false, message: error.message });
  }
};
