import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import DraftPayment from "../models/draftPaymentModel.js";
import Client from "../models/clientModel.js";
import DayPass from "../models/dayPassModel.js";
import DayPassBundle from "../models/dayPassBundleModel.js";
import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";

import Contract from "../models/contractModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import Building from "../models/buildingModel.js";
import { issueDayPass, issueDayPassBatch } from "../services/dayPassIssuanceService.js";
import { provisionAccessForMeetingBooking } from "../services/meetingAccessService.js";
import { getValidAccessToken } from '../utils/zohoTokenManager.js';
import crypto from 'crypto';
import { logPaymentActivity, logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import loggedRazorpay from "../utils/loggedRazorpay.js";
import apiLogger from "../utils/apiLogger.js";
import { applyPaymentToDeposit } from "./securityDepositController.js";
import imagekit from "../utils/imageKit.js";
import { getZohoCustomerPayment, updateZohoCustomerPayment, refundZohoExcessPayment, getZohoInvoice, createZohoInvoiceFromLocal, recordZohoPayment, deleteZohoPayment } from "../utils/zohoBooks.js";
import Item from "../models/itemModel.js";
import { pushInvoiceToZoho } from "../utils/loggedZohoBooks.js";
import { sendNotification } from "../utils/notificationHelper.js";

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

/**
 * Helper: add reserved slots to a meeting room for a given booking.
 * Logic mirrored from meetingBookingController.js / createBooking snippet.
 */
async function addMeetingRoomReservedSlot(bookingId) {
  try {
    const item = await MeetingBooking.findById(bookingId);
    if (!item || !item.room || !item.start || !item.end) return;

    const startDate = new Date(item.start);
    const endDate = new Date(item.end);

    const startTimeStr = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const endTimeStr = endDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const istDateStr = startDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const utcMidnightOfIstDay = new Date(`${istDateStr}T00:00:00.000Z`);

    const reservedSlot = {
      date: utcMidnightOfIstDay,
      dateISTYMD: istDateStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      bookingId: item._id
    };

    // Use findByIdAndUpdate to push to reservedSlots array
    await MeetingRoom.findByIdAndUpdate(item.room, {
      $push: { reservedSlots: reservedSlot }
    });
    console.log(`[MeetingRoom] Reserved slot added for booking ${bookingId} in room ${item.room}`);
  } catch (error) {
    console.warn(`[MeetingRoom] Failed to add reserved slot for booking ${bookingId}:`, error.message);
  }
}

/**
 * Internal version of applyAllCreditsToInvoice.
 * Automates the allocation of extra_credits (unused Zoho payments) to an invoice.
 */
async function applyExtraCreditsToInvoiceInternal(clientId, invoiceId) {
  try {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return { success: false, message: 'Invoice not found' };

    const zohoInvoiceId = invoice.zoho_invoice_id;
    if (!zohoInvoiceId) return { success: false, message: 'Invoice not synced to Zoho' };

    const localOutstanding = Number(invoice.balance || invoice.total || 0);
    let zohoOutstanding = localOutstanding;
    try {
      const zohoInv = await getZohoInvoice(zohoInvoiceId);
      zohoOutstanding = Number((zohoInv && (zohoInv.balance || zohoInv.balance_due || zohoInv.outstanding)) ?? 0);
    } catch (_) { }

    let need = Math.max(0, Math.min(localOutstanding, zohoOutstanding));
    if (need < 0.01) return { success: true, allocated: 0 };

    const payments = await Payment.find({ client: clientId, unused_amount: { $gt: 0 } }).sort({ createdAt: 1 });
    let totalAllocated = 0;

    for (const pay of payments) {
      if (need < 0.01) break;
      const payUnused = Number(pay.unused_amount || 0);
      if (payUnused <= 0.009 || !pay.zoho_payment_id) continue;

      let existingAllocations = [];
      try {
        const zohoPayment = await getZohoCustomerPayment(pay.zoho_payment_id);
        existingAllocations = (zohoPayment?.invoices || zohoPayment?.invoice_payments || []).map(ip => ({
          invoice_id: ip.invoice_id,
          amount_applied: Number(ip.amount_applied || ip.applied_amount || 0)
        }));
      } catch (_) { }

      const alloc = Math.min(need, payUnused);
      const prevForTarget = (existingAllocations.find(a => a.invoice_id === zohoInvoiceId)?.amount_applied) || 0;
      const newInvoices = [{ invoice_id: zohoInvoiceId, amount_applied: Math.round((prevForTarget + alloc) * 100) / 100 }];

      await updateZohoCustomerPayment(pay.zoho_payment_id, { invoices: newInvoices });

      pay.applied_total = Math.round(((Number(pay.applied_total || 0) + alloc)) * 100) / 100;
      pay.unused_amount = Math.max(0, Math.round(((Number(pay.unused_amount || 0) - alloc)) * 100) / 100);

      const invIdStr = invoiceId.toString();
      pay.invoices = pay.invoices || [];
      const existingLine = pay.invoices.find(pi => String(pi.invoice?._id || pi.invoice) === invIdStr);
      if (existingLine) {
        existingLine.amount_applied = Math.round((Number(existingLine.amount_applied || 0) + alloc) * 100) / 100;
      } else {
        pay.invoices.push({ invoice: invoiceId, amount_applied: alloc, zoho_invoice_id: zohoInvoiceId });
      }
      await pay.save();

      try { await Client.findByIdAndUpdate(clientId, { $inc: { extra_credits: -alloc } }); } catch (_) { }
      await updateInvoiceAfterZohoPayment(invoiceId, alloc);
      try { await applyPaymentToDeposit(invoiceId, alloc); } catch (_) { }

      totalAllocated = Math.round((totalAllocated + alloc) * 100) / 100;
      need = Math.max(0, Math.round((need - alloc) * 100) / 100);
    }

    return { success: true, allocated: totalAllocated };
  } catch (error) {
    console.error('applyExtraCreditsToInvoiceInternal failed:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Helper: compute invoice totals with 18% GST.
 */
function computeInvoiceTotals(baseAmount, percent) {
  const discountAmount = Math.round((baseAmount * (percent / 100)) * 100) / 100;
  const sub_total = Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100);
  const tax_total = Math.round((sub_total * 0.18) * 100) / 100;
  const total = Math.round((sub_total + tax_total) * 100) / 100;
  return { sub_total, discountAmount, tax_total, total };
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
    try { await applyPaymentToDeposit(invoiceId, Number(amount)); } catch (_) { }

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
    if (payment.zoho_payment_id) {
      try {
        console.log(`[Zoho:deletePayment] Deleting payment ${payment.zoho_payment_id} from Zoho Books...`);
        await deleteZohoPayment(payment.zoho_payment_id);
      } catch (zohoError) {
        console.error(`[Zoho:deletePayment] Failed to delete payment ${payment.zoho_payment_id} from Zoho:`, zohoError.message);
      }
    }
    try {
      const invoiceExists = await Invoice.findById(payment.invoice).select('_id');
      if (invoiceExists) {
        await applyInvoicePayment(payment.invoice, -Number(payment.amount || 0));
        // Reverse deposit applied amount as well
        try { await applyPaymentToDeposit(payment.invoice, -Number(payment.amount || 0)); } catch (_) { }
      }
    } catch (_) {
    }

    await Payment.findByIdAndDelete(id);

    // Log payment deletion
    await logCRUDActivity(req, 'DELETE', 'Payment', id, null, {
      invoiceId: payment.invoice,
      amount: payment.amount,
      paymentType: payment.type,
      zohoPaymentId: payment.zoho_payment_id
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
    let payment = await Payment.findById(id)
      .populate("invoice", "invoice_number total amount_paid balance due_date status")
      .populate("client", "companyName contactPerson phone email");

    if (!payment) {
      // Check if it's a draft payment
      payment = await DraftPayment.findById(id)
        .populate("invoice", "invoice_number total amount_paid balance due_date status")
        .populate("client", "companyName contactPerson phone email");

      if (payment) {
        // synthesize some fields for frontend compatibility if needed
        const p = payment.toObject();
        p.isDraft = true;
        return res.json({ success: true, data: p });
      }
    }

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

    // 1. Fetch Draft Payments (Pending only)
    const draftQuery = { client: clientId, status: "pending" };
    // If filtering by type/date, apply to drafts too if fields match (DraftPayment has 'type', 'paymentDate')
    if (type) draftQuery.type = type;
    if (from || to) {
      draftQuery.paymentDate = {};
      if (from) draftQuery.paymentDate.$gte = new Date(from);
      if (to) draftQuery.paymentDate.$lte = new Date(to);
    }

    // Fetch all pending drafts (usually few) to merge correctly. 
    // If strict pagination is needed across mixed collections, it's complex. 
    // Here we fetch drafts and mix them, assuming regular user won't have 1000s of *pending* drafts.
    const drafts = await DraftPayment.find(draftQuery)
      .populate("invoice", "invoice_number zoho_invoice_number total amount_paid balance due_date status building cabin")
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    // 2. Fetch Regular Payments
    // We adjust limit if we want to show mixed page, but simple approach:
    // Fetch 'limit' payments, combine with drafts, then slice?
    // User expects "Payment History" to show drafts. 
    // Strategy: Fetch payments normally. Prepend drafts to the list.
    // If pagination is requested (page 2), should drafts show again? Ideally only on page 1?
    // Or treating them as part of the stream.
    // Let's go with: Drafts always on top (if they are pending, they are "recent" actions).
    // Or strictly by date.

    // Attempting strict date merge for 'limit' items:
    // This is hard with simple Mongoose generic pagination.
    // Let's use the strategy: Fetch `limit` payments. Return `drafts + payments`.
    // NOTE: This might return `drafts.length + limit` items on page 1. This is acceptable for "Pending items at top" UI pattern.

    const payments = await Payment.find(query)
      .populate("invoice", "invoice_number zoho_invoice_number total amount_paid balance due_date status building cabin")
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .lean();

    const totalPayments = await Payment.countDocuments(query);
    const totalDrafts = await DraftPayment.countDocuments(draftQuery);
    const total = totalPayments + totalDrafts;

    // Mark drafts distinctively
    const formattedDrafts = drafts.map(d => ({ ...d, isDraft: true, status: 'pending' }));

    // If page 1, include drafts. If page > 1, maybe minimal drafts or none?
    // Usually pending drafts should be seen immediately. Let's send them on Page 1.
    let combined = [];
    if (Number(page) === 1) {
      combined = [...formattedDrafts, ...payments];
    } else {
      combined = payments; // On subsequent pages only show historical payments
    }

    // Retain sort if preferred, but usually "Actionable/Pending" items stay on top regardless of date (unless they are very old), 
    // but here we just prepend them on page 1.

    return res.json({
      success: true,
      data: {
        payments: combined,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(totalPayments / limit) // Approximate pages based on main collection
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
    due_date: invoice.due_date ? new Date(invoice.due_date).toISOString().split('T')[0] : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reference_number: invoice.reference_number || '',
    place_of_supply: invoice.place_of_supply || undefined,
    notes: invoice.notes || '',
    terms: invoice.terms || '',

    // Line items
    line_items: (invoice.line_items || []).map(item => ({
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
    is_inclusive_tax: invoice.is_inclusive_tax || false,
    ...(invoice.zoho_tax_id ? { tax_id: invoice.zoho_tax_id } : {}),
    ...(invoice.zoho_books_location_id ? { location_id: invoice.zoho_books_location_id } : {}),
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

  console.log(`Updated local invoice ${invoice.invoice_number} with Zoho invoice number: ${zohoInvoiceNumber}`);

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
      const dbInvoice = dbInvoices.find(dbInv => dbInv._id.toString() === paymentInv.invoiceId);
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
        // Non-blocking if Zoho fetch fails, continue with localOutstanding
      }
    }

    // Auto-create invoices in Zoho Books if they don't have zoho_invoice_id
    for (const dbInvoice of dbInvoices) {
      if (!dbInvoice.zoho_invoice_id) {
        console.log(`Creating invoice ${dbInvoice.invoice_number} in Zoho Books...`);

        try {
          const zohoResult = await createZohoInvoiceFromLocal(dbInvoice, client);
          if (zohoResult?.invoice) {
            dbInvoice.zoho_invoice_id = zohoResult.invoice.invoice_id;
            dbInvoice.zoho_invoice_number = zohoResult.invoice.invoice_number;
            dbInvoice.source = 'zoho';
            await dbInvoice.save();
            console.log(`Updated local invoice ${dbInvoice.invoice_number} with Zoho invoice number: ${dbInvoice.zoho_invoice_number}`);
          }
        } catch (error) {
          console.error(`Failed to create invoice ${dbInvoice.invoice_number} in Zoho:`, error.message);
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
          const zohoInv = await getZohoInvoice(dbInvoice.zoho_invoice_id);
          const zBal = Number(zohoInv?.balance || zohoInv?.balance_due || zohoInv?.outstanding || 0);
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

    // Determine location_id and deposit_to_account_id based on building associated with invoices
    let locationId = undefined;
    let finalDepositAccountId = deposit_to_account_id;

    if (dbInvoices && dbInvoices.length > 0) {
      const firstInvoice = dbInvoices[0];
      if (firstInvoice.building) {
        try {
          const b = await Building.findById(firstInvoice.building).select('zoho_books_location_id zohoChartsOfAccounts');
          if (b) {
            console.log(`[recordCustomerPayment] Found building ${b._id} for invoice. Location: ${b.zoho_books_location_id}, Account: ${b.zohoChartsOfAccounts?.bank_account_id}`);
            if (b.zoho_books_location_id) locationId = b.zoho_books_location_id;
            if (!finalDepositAccountId && b.zohoChartsOfAccounts?.bank_account_id) {
              finalDepositAccountId = b.zohoChartsOfAccounts.bank_account_id;
            }
          }
        } catch (err) {
          console.error(`[recordCustomerPayment] Error fetching building for invoice: ${err.message}`);
        }
      }
    }

    // Fallback to client's building if still missing
    if ((!locationId || !finalDepositAccountId) && client.building) {
      try {
        const b = await Building.findById(client.building).select('zoho_books_location_id zohoChartsOfAccounts');
        if (b) {
          if (!locationId && b.zoho_books_location_id) locationId = b.zoho_books_location_id;
          if (!finalDepositAccountId && b.zohoChartsOfAccounts?.bank_account_id) {
            finalDepositAccountId = b.zohoChartsOfAccounts.bank_account_id;
          }
        }
      } catch (err) {
        console.error(`[recordCustomerPayment] Error fetching building for client: ${err.message}`);
      }
    }

    if (locationId) {
      // Note: Zoho Books API for /customerpayments does NOT support location_id.
      // We keep it locally in case other systems need it, but it should not be in the Zoho payload.
    }
    if (finalDepositAccountId) {
      zohoPayload.account_id = finalDepositAccountId; // Zoho Books API uses 'account_id'
    }

    try {
      console.log("[recordCustomerPayment] Zoho payload amount:", zohoPayload.amount);
      console.log("[recordCustomerPayment] Zoho payload invoices:", (zohoPayload.invoices || []).map(i => ({ invoice_id: i.invoice_id, amount_applied: i.amount_applied, tax_amount_withheld: i.tax_amount_withheld })));
    } catch (_) { }

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

    // Call Zoho Books API via utility
    const zohoData = await recordZohoPayment(null, zohoPayload);
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
      deposit_to_account_id: finalDepositAccountId,

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
        try { if (allowed > 0.009) await applyPaymentToDeposit(inv.invoiceId, allowed); } catch (_) { }
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
      } catch (_) { }
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

// Create a shareable Razorpay Payment Link for a meeting booking
export const createRazorpayPaymentLink = async (req, res) => {
  try {
    const { meetingBookingId, dayPassId, invoiceId } = req.body || {};

    if (!meetingBookingId && !dayPassId && !invoiceId) {
      return res.status(400).json({ success: false, message: 'Provide one of: meetingBookingId, dayPassId, invoiceId' });
    }

    // Day Pass: generate payment link for a pending day pass
    if (dayPassId) {
      const pass = await DayPass.findById(dayPassId).populate('invoice').populate('building').populate('customer');
      if (!pass) {
        return res.status(404).json({ success: false, message: 'Day pass not found' });
      }
      if (pass.status !== 'payment_pending') {
        return res.status(400).json({ success: false, message: `Cannot generate payment link when day pass status is ${pass.status}` });
      }
      let amount = 0;
      if (pass.invoice && typeof pass.invoice.total === 'number') {
        amount = Number(pass.invoice.total);
      } else if (typeof pass.price === 'number') {
        const gstRate = 18;
        const taxAmount = Math.round(((pass.price * gstRate) / 100) * 100) / 100;
        amount = Math.round(((pass.price + taxAmount)) * 100) / 100;
      }
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid amount for day pass' });
      }
      const linkData = {
        amount: Math.round(amount * 100),
        currency: 'INR',
        description: `Day Pass - ${pass.building?.name || 'Booking'}`,
        reference_id: `day_pass_${pass._id}`,
        notes: {
          type: 'day_pass',
          dayPassId: String(pass._id),
          ...(pass.invoice?._id && { invoiceId: String(pass.invoice._id) }),
        },
      };
      const cust = pass.customer || {};
      if (cust.name && (cust.email || cust.phone)) {
        linkData.customer = { name: cust.name, email: cust.email, contact: cust.phone };
      }
      const result = await loggedRazorpay.createPaymentLink(linkData, {
        userId: req.user?.id || null,
        relatedEntity: 'DayPass',
        relatedEntityId: String(pass._id),
      });
      return res.json({ success: true, data: { id: result.id, short_url: result.short_url, status: result.status } });
    }

    // Invoice: fallback link creation directly from invoice
    if (invoiceId) {
      const inv = await Invoice.findById(invoiceId).populate('client');
      if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
      const amount = Number(inv.balance || inv.total || 0);
      if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid invoice amount' });
      const linkData = {
        amount: Math.round(amount * 100),
        currency: 'INR',
        description: `Invoice ${inv.invoice_number || inv._id}`,
        reference_id: `invoice_${inv._id}`,
        notes: {
          type: 'invoice',
          invoiceId: String(inv._id),
        },
      };
      const cl = inv.client || {};
      if ((cl.companyName || cl.legalName) && (cl.email || cl.phone)) {
        linkData.customer = { name: cl.companyName || cl.legalName, email: cl.email, contact: cl.phone };
      }
      const result = await loggedRazorpay.createPaymentLink(linkData, {
        userId: req.user?.id || null,
        relatedEntity: 'Invoice',
        relatedEntityId: String(inv._id),
      });
      return res.json({ success: true, data: { id: result.id, short_url: result.short_url, status: result.status } });
    }

    // Meeting booking: existing behavior
    if (!meetingBookingId) {
      return res.status(400).json({ success: false, message: 'Provide one of: meetingBookingId, dayPassId, invoiceId' });
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
    let amount = 0;
    if (booking.invoice && typeof booking.invoice.total === 'number') {
      amount = Number(booking.invoice.total);
    } else {
      const hourlyRate = booking.room?.pricing?.hourlyRate || 500;
      const durationHours = (new Date(booking.end) - new Date(booking.start)) / (1000 * 60 * 60);
      const baseAmount = Math.max(0, Number(hourlyRate) * Number(durationHours));
      const totals = computeInvoiceTotals(baseAmount, booking.appliedDiscountPercent || 0);
      amount = Number(totals.total);
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount for booking' });
    }
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
    const cust = booking.customer || {};
    if (cust.name && (cust.email || cust.phone)) {
      linkData.customer = { name: cust.name, email: cust.email, contact: cust.phone };
    }
    const result = await loggedRazorpay.createPaymentLink(linkData, {
      userId: req.user?.id || null,
      relatedEntity: 'MeetingBooking',
      relatedEntityId: String(booking._id),
    });
    return res.json({ success: true, data: { id: result.id, short_url: result.short_url, status: result.status } });
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
    const { dayPassId, bundleId, meetingBookingId, useExtraCredits = false, clientId: bodyClientId } = req.body || {};

    if (!dayPassId && !bundleId && !meetingBookingId) {
      return res.status(400).json({ error: "Day pass ID, Bundle ID, or Meeting Booking ID is required" });
    }

    let item, amount, description, buildingName;
    let invoice = null;

    if (dayPassId) {
      // Single day pass payment
      const dayPass = await DayPass.findById(dayPassId)
        .populate('building', 'openSpacePricing')
        .populate('invoice', 'total');

      if (!dayPass) {
        return res.status(404).json({ error: "Day pass not found" });
      }

      if (dayPass.status !== 'payment_pending') {
        return res.status(400).json({ error: "Day pass is not pending payment" });
      }

      amount = dayPass.invoice?.total || dayPass.totalAmount || dayPass.price;
      buildingName = dayPass.building?.name || "Workspace";
      description = `Day Pass - ${buildingName}`;
      item = { type: 'daypass', id: dayPassId };
      invoice = dayPass.invoice || null;
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
      invoice = bundle.invoice || null;
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
      const startTime = new Date(booking.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endTime = new Date(booking.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      description = `Meeting Room - ${roomName} (${startTime}-${endTime})`;
      item = { type: 'meeting', id: meetingBookingId };
      invoice = booking.invoice || null;
    }

    // Early exit ONLY when 'Use available credits first' is enabled and invoice is fully paid
    if (useExtraCredits && invoice && invoice._id) {
      try {
        const invFull = await Invoice.findById(invoice._id);
        const invBalance = invFull
          ? (invFull.balance != null
            ? Number(invFull.balance)
            : Math.max(0, Number(invFull.total || 0) - Number(invFull.amount_paid || 0)))
          : Number(amount || 0);
        if (invFull && invBalance <= 0.009) {
          if (item.type === 'bundle') {
            const dayPasses = await DayPass.find({ bundle: item.id });
            const dayPassIds = dayPasses.map(p => p._id.toString());
            await issueDayPassBatch(dayPassIds);
            const bundleDoc = await DayPassBundle.findById(item.id);
            if (bundleDoc) { bundleDoc.status = 'issued'; await bundleDoc.save(); }
          } else if (item.type === 'daypass') {
            await issueDayPass(item._id);
          } else if (item.type === 'meeting') {
            const bookingDoc = await MeetingBooking.findById(item.id);
            if (bookingDoc) { bookingDoc.status = 'booked'; await bookingDoc.save(); }
            // Provision BHAiFi + Matrix access for the booked meeting timeslot
            try { await provisionAccessForMeetingBooking({ bookingId: item.id }); } catch (e) { console.warn('[MeetingAccess] Provision failed on create-order (credits covered)', e?.message); }
          }

          const response = {
            success: true,
            razorpayKey: process.env.RAZORPAY_KEY_ID,
            amount: 0,
            currency: 'INR',
            item,
            buildingName,
            description,
            noPaymentRequired: true,
            message: 'Covered by available credits; no Razorpay payment required.'
          };
          await apiLogger.logWebhookResponse(requestId, 200, response, true);
          return res.json(response);
        }
      } catch (_) { }
    }

    // Resolve client for allocation/logging
    let clientForZoho = null;
    if (bodyClientId) {
      clientForZoho = await Client.findById(bodyClientId);
    } else if (item?.type === 'daypass') {
      const dp = await DayPass.findById(item.id)
        .populate({ path: 'customer', select: 'client zohoBooksContactId', options: { strictPopulate: false } })
        .populate('invoice');
      if (dp?.customer) {
        const ctor = dp.customer.constructor?.modelName;
        if (ctor === 'Client') clientForZoho = dp.customer;
        else if (ctor === 'Member') {
          const mem = await Member.findById(dp.customer._id).populate('client');
          clientForZoho = mem?.client || null;
        }
      }
    } else if (item?.type === 'bundle') {
      const b = await DayPassBundle.findById(item.id)
        .populate({ path: 'customer', select: 'client zohoBooksContactId', options: { strictPopulate: false } })
        .populate('invoice');
      if (b?.customer) {
        const ctor = b.customer.constructor?.modelName;
        if (ctor === 'Client') clientForZoho = b.customer;
        else if (ctor === 'Member') {
          const mem = await Member.findById(b.customer._id).populate('client');
          clientForZoho = mem?.client || null;
        }
      }
    } else if (item?.type === 'meeting') {
      const mb = await MeetingBooking.findById(item.id).populate({ path: 'member', select: 'client' }).populate('client').populate('invoice');
      clientForZoho = mb?.client || null;
      if (!clientForZoho && mb?.member) {
        const mem = await Member.findById(mb.member._id).populate('client');
        clientForZoho = mem?.client || null;
      }
      if (!clientForZoho && bodyClientId) {
        clientForZoho = await Client.findById(bodyClientId);
      }
    }

    if (useExtraCredits && invoice) {
      if (clientForZoho?._id) {
        // Ensure invoice exists in Zoho before allocation
        if (!invoice.zoho_invoice_id) {
          try {
            await createInvoiceInZoho(invoice, clientForZoho);
          } catch (syncErr) {
            // If client is not linked to Zoho, try to auto-link by creating a contact
            try {
              if (!clientForZoho.zohoBooksContactId) {
                const { findOrCreateContactFromClient } = await import('../utils/loggedZohoBooks.js');
                const contactId = await findOrCreateContactFromClient(clientForZoho, { userId: req.user?.id || null });
                if (contactId) {
                  clientForZoho.zohoBooksContactId = contactId;
                  await clientForZoho.save();
                }
              }
            } catch (linkErr) {
              return res.status(400).json({ error: 'Unable to sync invoice to Zoho for credit application', reason: `Client not linked to Zoho Books: ${linkErr?.message || linkErr}` });
            }

            // Retry creating invoice after linking client
            try {
              await createInvoiceInZoho(invoice, clientForZoho);
            } catch (retryErr) {
              return res.status(400).json({ error: 'Unable to sync invoice to Zoho for credit application', reason: retryErr?.message || retryErr });
            }
          }
        }
        if (!invoice.zoho_invoice_id) {
          return res.status(400).json({ error: 'Unable to sync invoice to Zoho for credit application', reason: 'Unknown reason (invoice has no zoho_invoice_id after sync attempts)' });
        }

        // Apply credits to invoice and refresh remaining amount
        const result = await applyExtraCreditsToInvoiceInternal(clientForZoho._id, invoice._id);
        try { invoice = await Invoice.findById(invoice._id); } catch (_) { }
        const remaining = Math.max(0, Number(invoice?.balance || 0));
        amount = remaining;

        if (remaining <= 0.009) {
          // Fully covered by credits: issue the items and skip Razorpay
          if (item.type === 'bundle') {
            const dayPasses = await DayPass.find({ bundle: item.id });
            const dayPassIds = dayPasses.map(p => p._id.toString());
            await issueDayPassBatch(dayPassIds);
            const bundleDoc = await DayPassBundle.findById(item.id);
            if (bundleDoc) { bundleDoc.status = 'issued'; await bundleDoc.save(); }
          } else if (item.type === 'daypass') {
            await issueDayPass(item._id);
          } else if (item.type === 'meeting') {
            const bookingDoc = await MeetingBooking.findById(item.id);
            if (bookingDoc) { bookingDoc.status = 'booked'; await bookingDoc.save(); }
            // Add reserved slot to meeting room
            await addMeetingRoomReservedSlot(item.id);
            // Provision BHAiFi + Matrix access for the booked meeting timeslot
            try { await provisionAccessForMeetingBooking({ bookingId: item.id }); } catch (e) { console.warn('[MeetingAccess] Provision failed on create-order (credits covered)', e?.message); }
          }


          const response = {
            success: true,
            razorpayKey: process.env.RAZORPAY_KEY_ID,
            amount: 0,
            currency: 'INR',
            item,
            buildingName,
            description,
            noPaymentRequired: true,
            message: 'Covered by available credits; no Razorpay payment required.'
          };
          await apiLogger.logWebhookResponse(requestId, 200, response, true);
          return res.json(response);
        }
      }
    }

    const response = {
      success: true,
      razorpayKey: process.env.RAZORPAY_KEY_ID,
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      item,
      buildingName,
      description
    };

    // --- Order Idempotency Check for Meeting Bookings ---
    // If the frontend passed an idempotencyKey, check if we already have an active order for it.
    // This prevents double-creation if the user clicks "Pay" twice rapidly or network drops.
    // We reuse the primary idempotencyKey to keep the API surface simple.
    const checkoutIdempotencyKey = req.body.idempotencyKey;
    if (checkoutIdempotencyKey && item.type === 'meeting') {
      try {
        const bookingCheck = await MeetingBooking.findOne({
          _id: item.id,
          'payment.idempotencyKey': checkoutIdempotencyKey,
          'payment.razorpayOrderId': { $exists: true }
        }).lean();

        if (bookingCheck && bookingCheck.payment.razorpayOrderId) {
          // We already created an order for this exact checkout attempt.
          // Verify the amount hasn't somehow changed (it shouldn't for the same key).
          if (bookingCheck.payment.amount === response.amount) {
            response.order_id = bookingCheck.payment.razorpayOrderId;
            await apiLogger.logWebhookResponse(requestId, 200, response, true);
            return res.json(response);
          }
        }
      } catch (e) {
        console.warn("Error checking order idempotency:", e.message);
      }
    }

    // Create actual Razorpay order
    try {
      const rzpOrder = await loggedRazorpay.createOrder({
        amount: response.amount,
        currency: response.currency,
        receipt: `receipt_${item.type}_${item.id}`
      }, {
        userId: req.user?._id,
        clientId: clientForZoho?._id || bodyClientId || null,
        relatedEntity: item.type === 'daypass' ? 'DayPass' : (item.type === 'bundle' ? 'DayPassBundle' : (item.type === 'meeting' ? 'MeetingBooking' : null)),
        relatedEntityId: item.id
      });
      response.order_id = rzpOrder.id;

      // Save the generated order ID and the idempotency key back to the booking
      // Note: we update the primary idempotencyKey here as well, so order tracking
      // relies on the same key as creation tracking.
      if (item.type === 'meeting' && checkoutIdempotencyKey) {
        await MeetingBooking.updateOne(
          { _id: item.id },
          {
            $set: {
              'payment.idempotencyKey': checkoutIdempotencyKey,
              'payment.razorpayOrderId': rzpOrder.id,
              'payment.amount': response.amount
            }
          }
        );
      }

    } catch (rzpErr) {
      console.error("Failed to create Razorpay order in createRazorpayOrder:", rzpErr);
      return res.status(500).json({
        error: "Failed to initialize Razorpay payment",
        reason: rzpErr.message,
        message: "A valid Razorpay order could not be created. Please check backend credentials."
      });
    }


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
      useExtraCredits = false,
      clientId,
      amount,
      invoiceId
    } = req.body;

    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'amount (in paise) is required in request body' });
    }

    if (!razorpay_payment_id || (!dayPassId && !bundleId && !meetingBookingId)) {
      return res.status(400).json({ error: "Payment ID and Day Pass ID, Bundle ID, or Meeting Booking ID are required" });
    }

    let item, customer, invoice, paymentNotes;

    if (dayPassId) {
      // Single day pass payment
      const dayPass = await DayPass.findById(dayPassId)
        .populate('invoice')
        .populate('member')
        .populate('customer')
        .populate('building');

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
        .populate('member')
        .populate('customer')
        .populate('building');

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
        .populate({ path: 'member', select: 'client' })
        .populate({ path: 'client', select: 'companyName zohoBooksContactId' })
        .populate({ path: 'room', populate: { path: 'building' } });

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

    // Resolve customer document
    let customerDoc = null;
    if (dayPassId || bundleId) {
      if (item.customer) {
        customerDoc = item.customer;
      }
    } else if (meetingBookingId) {
      customerDoc = item.client || item.member;
      if (!customerDoc && item.member) {
        customerDoc = await Member.findById(item.member._id).populate('client');
        if (customerDoc?.client) customerDoc = customerDoc.client;
      }
    }
    let finalDepositAccountId = null;
    try {
      let buildingId =
        item.room?.building?._id || item.room?.building ||
        item.building?._id || item.building;

      console.log(`[handleRazorpaySuccess][AccountLookup] Type: ${meetingBookingId ? 'meeting' : (bundleId ? 'bundle' : 'daypass')}, buildingId resolved: ${buildingId}, item.room?.building:`, item.room?.building, `, item.building:`, item.building);

      if (!buildingId && (dayPassId || bundleId)) {
        // Fallback: fetch from DB directly if building wasn't populated
        const Model = dayPassId ? DayPass : DayPassBundle;
        const raw = await Model.findById(dayPassId || bundleId).select('building').lean();
        buildingId = raw?.building;
        console.log(`[handleRazorpaySuccess][AccountLookup] Fallback DB buildingId: ${buildingId}`);
      }

      if (!buildingId && meetingBookingId) {
        // Fallback for meeting: fetch room's building ID directly
        const bookingRaw = await MeetingBooking.findById(meetingBookingId).select('room').populate({ path: 'room', select: 'building' }).lean();
        buildingId = bookingRaw?.room?.building;
        console.log(`[handleRazorpaySuccess][AccountLookup] Meeting fallback buildingId: ${buildingId}`);
      }

      if (buildingId) {
        const b = await Building.findById(buildingId).select('zohoChartsOfAccounts');
        console.log(`[handleRazorpaySuccess][AccountLookup] zohoChartsOfAccounts:`, JSON.stringify(b?.zohoChartsOfAccounts));
        if (b?.zohoChartsOfAccounts?.bank_account_id) {
          finalDepositAccountId = b.zohoChartsOfAccounts.bank_account_id;
          console.log(`[handleRazorpaySuccess] ✅ Derived building-level account_id: ${finalDepositAccountId} for building ${buildingId}`);
        } else {
          console.warn(`[handleRazorpaySuccess] ⚠️ Building ${buildingId} has no zohoChartsOfAccounts.bank_account_id set`);
        }
      } else {
        console.warn(`[handleRazorpaySuccess] ⚠️ Could not resolve buildingId for this payment`);
      }
    } catch (err) {
      console.warn(`[handleRazorpaySuccess] Failed to derive building-level account_id: ${err.message}`);
    }

    // Define paymentData for use in deferred invoice and payment record
    const paymentData = {
      invoice: invoice?._id,
      client: clientId || (customerDoc?.constructor?.modelName === 'Client' ? customerDoc._id : (customerDoc?.client || null)),
      guest: !clientId && customerDoc?.constructor?.modelName === 'Guest' ? customerDoc._id : null,
      amount: Number(amount) / 100,
      paymentDate: new Date(),
      referenceNumber: razorpay_payment_id,
      paymentGatewayRef: razorpay_payment_id,
      type: "Razorpay",
      currency: "INR",
      notes: paymentNotes,
      source: "webhook",
      status: "completed",
      deposit_to_account_id: finalDepositAccountId
    };

    // --- Deferred Invoice Creation Logic ---
    if (!invoice && (dayPassId || bundleId || meetingBookingId)) {
      console.log(`[Payment] Invoice missing for ${dayPassId ? 'Day Pass' : (bundleId ? 'Bundle' : 'Booking')}. Creating deferred invoice.`);

      try {
        const buildingId = item.building?._id || (item.room?.building?._id || item.building);
        const { default: Building } = await import('../models/buildingModel.js');
        const building = await Building.findById(buildingId);

        const clientIdForInvoice = clientId || (customerDoc?.constructor?.modelName === 'Client' ? customerDoc._id : null);
        const guestIdForInvoice = !clientIdForInvoice ? (customerDoc?.constructor?.modelName === 'Guest' ? customerDoc._id : null) : null;

        let lineItems = [];
        let baseAmount = 0;
        let taxAmount = 0;
        let finalAmount = paymentData.amount;
        let gstRate = 18;

        let resolvedItem = null;
        const dayPassItem = building?.dayPassItem ? await Item.findById(building.dayPassItem) : null;
        const meetingItem = building?.meetingItem ? await Item.findById(building.meetingItem) : null;

        if (dayPassId) {
          resolvedItem = dayPassItem;
          baseAmount = item.price;
          taxAmount = Math.round(((baseAmount * gstRate) / 100) * 100) / 100;
          lineItems = [{
            description: `Day Pass - ${building?.name || 'Workspace'}`,
            quantity: 1,
            unitPrice: baseAmount,
            amount: baseAmount,
            rate: baseAmount,
            tax_percentage: gstRate,
            item_id: resolvedItem?.zoho_item_id || undefined
          }];
        } else if (bundleId) {
          resolvedItem = dayPassItem;
          baseAmount = Math.round((finalAmount / (1 + gstRate / 100)) * 100) / 100;
          taxAmount = finalAmount - baseAmount;
          lineItems = [{
            description: `Day Pass Bundle - ${building?.name || 'Workspace'} (${item.no_of_dayPasses} passes)`,
            quantity: item.no_of_dayPasses,
            unitPrice: item.pricePerPass || (baseAmount / item.no_of_dayPasses),
            amount: baseAmount,
            rate: item.pricePerPass || (baseAmount / item.no_of_dayPasses),
            tax_percentage: gstRate,
            item_id: resolvedItem?.zoho_item_id || undefined
          }];
        } else if (meetingBookingId) {
          resolvedItem = meetingItem;
          baseAmount = Math.round((finalAmount / (1 + gstRate / 100)) * 100) / 100;
          taxAmount = finalAmount - baseAmount;
          lineItems = [{
            description: `Meeting Room Booking - ${item.room?.name || 'Room'}`,
            quantity: 1,
            unitPrice: baseAmount,
            amount: baseAmount,
            rate: baseAmount,
            tax_percentage: gstRate,
            item_id: resolvedItem?.zoho_item_id || undefined
          }];
        }

        invoice = new Invoice({
          client: clientIdForInvoice,
          guest: guestIdForInvoice,
          building: buildingId,
          type: "regular",
          category: dayPassId ? "day_pass" : (bundleId ? "day_pass" : "meeting_room"),
          invoice_number: `${dayPassId ? 'DP' : (bundleId ? 'DPB' : 'MR')}-${Date.now()}`,
          line_items: lineItems,
          sub_total: baseAmount,
          tax_total: taxAmount,
          total: finalAmount,
          status: "draft",
          due_date: (() => {
            const now = new Date();
            const dueDayConfig = building?.draftInvoiceDueDay || 7;
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const daysInNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
            const finalDueDay = Math.min(Math.max(1, dueDayConfig), daysInNextMonth);
            return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), finalDueDay);
          })(),
          place_of_supply: building?.place_of_supply || (customerDoc?.constructor?.modelName === 'Guest' ? customerDoc?.billingAddress?.state_code : undefined) || "HR",
          zoho_tax_id: building?.zoho_tax_id || undefined,
          zoho_books_location_id: building?.zoho_books_location_id || undefined
        });

        await invoice.save();
        item.invoice = invoice._id;
        await item.save();

        // Sync with Zoho immediately for deferred invoices
        if (clientIdForInvoice) {
          const clientDocForSync = await Client.findById(clientIdForInvoice);
          if (clientDocForSync) {
            await pushInvoiceToZoho(invoice, clientDocForSync, { blocking: false });
          }
        }

        paymentData.invoice = invoice._id;
        console.log(`[Payment] Deferred invoice created: ${invoice.invoice_number}`);

      } catch (invErr) {
        console.error('[Payment] Failed to create deferred invoice:', invErr.message);
        // Non-blocking but serious
      }
    }

    // Idempotency: Create payment record only if it doesn't already exist for this Razorpay ID
    let payment = await Payment.findOne({ paymentGatewayRef: razorpay_payment_id });
    let isDuplicatePayment = false;

    if (payment) {
      // We already processed this payment (e.g., from webhook or duplicate click)
      isDuplicatePayment = true;
      console.log(`[Payment] Duplicate payment detected: ${razorpay_payment_id}. Proceeding to return success without reprocessing state.`);
    } else {
      payment = new Payment(paymentData);
      try {
        await payment.save();
      } catch (saveErr) {
        if (saveErr.code === 11000) {
          // Caught exact duplicate race condition during save
          isDuplicatePayment = true;
          payment = await Payment.findOne({ paymentGatewayRef: razorpay_payment_id });
          if (!payment) throw saveErr; // Shouldn't happen
        } else {
          throw saveErr;
        }
      }
    }

    // Skip all provisioning, emailing, and slot reservations if we already processed this
    if (isDuplicatePayment) {
      const response = {
        success: true,
        message: "Payment was already processed successfully",
        item,
        payment: {
          id: payment._id,
          razorpay_payment_id,
          amount: payment.amount,
          status: "completed"
        }
      };
      await apiLogger.logWebhookResponse(requestId, 200, response, true);
      return res.json(response);
    }


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

      // Provision per issued pass (skip if Guest KYC pending)
      for (const pid of dayPassIds) {
        try { await maybeProvisionAfterIssuanceForDayPassId(pid); } catch (_) { }
      }

      // Update bundle status
      item.status = "issued";
      await item.save();
    } else if (dayPassId) {
      // For single day pass, use the issuance service
      await issueDayPass(item._id);
      try { await maybeProvisionAfterIssuanceForDayPassId(item._id); } catch (_) { }
    } else if (meetingBookingId) {
      // For meeting room booking, update status to booked
      item.status = "booked";
      await item.save();
      // Add reserved slot to meeting room
      await addMeetingRoomReservedSlot(item._id);
      // Provision BHAiFi + Matrix access for the booked meeting timeslot
      try { await provisionAccessForMeetingBooking({ bookingId: item._id }); } catch (e) { console.warn('[MeetingAccess] Provision failed on razorpay success', e?.message); }
    }


    // Send payment success notification
    try {
      let serviceType = "Other Service";
      let serviceName = "Service";
      let buildingName = "Ofis Square";
      let serviceDate = new Date().toISOString().slice(0, 10);
      let timeSlot = "N/A";

      if (dayPassId) {
        serviceType = "Day Pass";
        serviceName = "Day Pass";
        buildingName = item.building?.name || "Ofis Square";
        serviceDate = item.date ? new Date(item.date).toISOString().slice(0, 10) : serviceDate;
        timeSlot = "Full Day";
      } else if (bundleId) {
        serviceType = "Day Pass Bundle";
        serviceName = item.name || "Day Pass Bundle";
        buildingName = "Ofis Square"; // Bundles might be multi-building
        timeSlot = "N/A";
      } else if (meetingBookingId) {
        serviceType = "Meeting Room";
        serviceName = item.room?.name || "Meeting Room";
        buildingName = item.room?.building?.name || "Ofis Square";
        serviceDate = item.start ? new Date(item.start).toISOString().slice(0, 10) : serviceDate;

        // Format time slot
        if (item.start && item.end) {
          const startStr = new Date(item.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
          const endStr = new Date(item.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
          timeSlot = `${startStr} - ${endStr}`;
        }
      }

      // Fetch email address for notification
      let customerEmail = null;
      if (customer) {
        if (customer.constructor.modelName === 'Client') {
          const clientDoc = await Client.findById(customer._id).select('email').lean();
          customerEmail = clientDoc?.email;
        } else if (customer.constructor.modelName === 'Member') {
          const memberDoc = await Member.findById(customer._id).select('email').lean();
          customerEmail = memberDoc?.email;
        } else if (customer.constructor.modelName === 'Guest') {
          const guestDoc = await Guest.findById(customer._id).select('email').lean();
          customerEmail = guestDoc?.email;
        }
      }

      await sendNotification({
        to: {
          clientId: customer?.constructor?.modelName === 'Client' ? customer._id : undefined,
          memberId: customer?.constructor?.modelName === 'Member' ? customer._id : undefined,
          guestId: customer?.constructor?.modelName === 'Guest' ? customer._id : undefined,
          email: customerEmail
        },
        channels: { email: true, sms: true },
        templateKey: "service_payment_success",
        title: "Payment Successful",
        templateVariables: {
          greeting: "Ofis Square",
          serviceType,
          serviceName,
          buildingName,
          serviceDate,
          timeSlot,
          amount: paymentData.amount,
          paymentMode: "Razorpay",
          transactionId: razorpay_payment_id,
          invoiceNumber: invoice?.invoice_number || invoice?.reference_number || "N/A",
          paymentDate: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
          paymentId: payment._id
        },
        metadata: {
          category: "payments",
          tags: ["payment", "success", "booking"],
          route: `/payments/receipts/${payment._id}`,
          deepLink: `ofis://payments/receipts/${payment._id}`,
          routeParams: { id: String(payment._id) }
        },
        source: "system",
        type: "transactional"
      });
    } catch (notifyErr) {
      console.warn('handleRazorpaySuccess: failed to send service_payment_success notification:', notifyErr?.message || notifyErr);
    }


    // Convert paise to INR and floor to avoid rounding up (e.g., 2033.99 -> 2033)
    const paymentInrFloor = Math.floor(Number(amount) / 100);

    // If invoice not resolved from item but invoiceId was provided, fetch it now
    if (!invoice && invoiceId) {
      try {
        invoice = await Invoice.findById(invoiceId);
      } catch (_) { }
    }

    console.log(`[ZohoSync] Starting Zoho sync evaluation. Invoice found: ${!!invoice}`);

    // Update invoice and push to Zoho for meeting bookings
    if (invoice) {
      // If this is a meeting booking flow, mirror day pass Zoho integration
      if (meetingBookingId) {
        try {
          // Re-fetch booking to get client linkage
          const bookingForZoho = await MeetingBooking.findById(meetingBookingId)
            .populate({ path: 'member', select: 'client' })
            .populate('client');
          let clientForZoho = bookingForZoho?.client || null;
          if (!clientForZoho && bookingForZoho?.member) {
            const mem = await Member.findById(bookingForZoho.member._id).populate('client');
            clientForZoho = mem?.client || null;
          }
          if (clientForZoho && !invoice?.zoho_invoice_id) {
            try {
              const zohoData = await createZohoInvoiceFromLocal(invoice, clientForZoho);
              if (zohoData?.invoice) {
                invoice.zoho_invoice_id = zohoData.invoice.invoice_id;
                invoice.zoho_invoice_number = zohoData.invoice.invoice_number;
                invoice.source = 'zoho';
                await invoice.save();
              }
            } catch (invoiceErr) {
              console.error('Zoho invoice creation failed for meeting booking:', invoiceErr.message);
            }
          }

          // If we have client and a zoho invoice id, record customer payment in Zoho
          if (clientForZoho?.zohoBooksContactId && invoice?.zoho_invoice_id) {
            try {
              const zohoPayload = {
                customer_id: clientForZoho.zohoBooksContactId,
                payment_mode: 'Razorpay',
                amount: paymentInrFloor,
                date: new Date().toISOString().slice(0, 10),
                invoices: [{ invoice_id: invoice.zoho_invoice_id, amount_applied: paymentInrFloor }],
                reference_number: razorpay_payment_id,
                description: paymentNotes,
                ...(finalDepositAccountId && { account_id: finalDepositAccountId })
              };

              const zohoData = await recordZohoPayment(invoice.zoho_invoice_id, zohoPayload);
              if (zohoData?.payment) {
                // Update local payment with Zoho details
                payment.zoho_payment_id = zohoData.payment.payment_id;
                payment.payment_number = zohoData.payment.payment_number;
                payment.zoho_status = zohoData.payment.status;
                payment.raw_zoho_response = zohoData;
                payment.source = 'zoho_books';
                await payment.save();
                // Apply locally now with the same floored amount
                await applyInvoicePayment(invoice._id, paymentInrFloor);
              }
            } catch (paymentErr) {
              console.error('Zoho customer payment failed for meeting booking:', paymentErr.message);
              // Even if Zoho fails, apply locally
              await applyInvoicePayment(invoice._id, paymentInrFloor);
            }
          }

          // Send meeting booking confirmation notification after invoice is created
          try {
            const bookingForNotif = await MeetingBooking.findById(meetingBookingId)
              .populate('member')
              .populate({ path: 'room', populate: { path: 'building' } });

            if (bookingForNotif && bookingForNotif.status === 'booked') {
              const memberDoc = bookingForNotif.member;
              const room = bookingForNotif.room;

              const to = {};
              let emailTo = null;
              if (memberDoc?._id) {
                to.memberId = memberDoc._id;
                if (memberDoc?.client) to.clientId = memberDoc.client;
                if (memberDoc?.email) emailTo = memberDoc.email;
              }
              if (emailTo) to.email = emailTo;

              // Format time slots
              const startTimeStr = new Date(bookingForNotif.start).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Kolkata'
              });
              const endTimeStr = new Date(bookingForNotif.end).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Kolkata'
              });
              const istYmd = new Date(bookingForNotif.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

              await sendNotification({
                to,
                channels: { email: Boolean(emailTo), sms: false },
                templateKey: 'meeting_booking_confirmed',
                templateVariables: {
                  greeting: memberDoc?.companyName || 'Ofis Square',
                  memberName: memberDoc?.firstName || 'Member',
                  companyName: memberDoc?.companyName || 'Ofis Square',
                  meetingRoom: room?.name,
                  building: room?.building?.name || 'Ofis Square',
                  timeSlot: `${startTimeStr} - ${endTimeStr}`,
                  date: istYmd,
                  bookingId: String(bookingForNotif._id)
                },
                title: 'Meeting Booking Confirmed',
                metadata: {
                  category: 'meeting_booking',
                  tags: ['meeting_booking_confirmed'],
                  route: `/meeting-bookings/${bookingForNotif._id}`,
                  deepLink: `ofis://meeting-bookings/${bookingForNotif._id}`,
                  routeParams: { id: String(bookingForNotif._id) }
                },
                source: 'system',
                type: 'transactional'
              });
            }
          } catch (notifyErr) {
            console.warn('handleRazorpaySuccess: failed to send meeting_booking_confirmed notification:', notifyErr?.message || notifyErr);
          }
        } catch (zohoErr) {
          console.error('Meeting booking Zoho sync error:', zohoErr);
          // On error, still apply locally
          await applyInvoicePayment(invoice._id, paymentInrFloor);
        }
      }

      // If this is a day pass or bundle payment, sync to Zoho Books similarly
      if (dayPassId || bundleId) {
        console.log(`[ZohoSync] Evaluating DayPass/Bundle Zoho sync for ${dayPassId || bundleId}`);
        // Track whether we applied locally during Zoho success to avoid double-applying later
        let appliedViaZohoSuccess = false;

        try {
          // Re-fetch day pass or bundle with customer and invoice populated
          let itemForZoho = null;
          let clientForZoho = null;
          if (dayPassId) {
            itemForZoho = await DayPass.findById(dayPassId)
              .populate('customer')
              .populate('invoice');
          } else if (bundleId) {
            itemForZoho = await DayPassBundle.findById(bundleId)
              .populate('customer')
              .populate('invoice');
          }

          // Resolve client/guest for Zoho
          if (itemForZoho?.member) {
            // member is populated due to ref: "Member"
            const mem = await Member.findById(itemForZoho.member._id || itemForZoho.member).populate('client');
            clientForZoho = mem?.client || null;
          } else if (itemForZoho?.customer) {
            const rawCustomer = itemForZoho.customer._id || itemForZoho.customer;
            // If it's a guest, find it
            const guest = await Guest.findById(rawCustomer);
            if (guest) {
              clientForZoho = guest;
            } else {
              // Fallback to Member/Client check if not a guest
              const mem = await Member.findById(rawCustomer).populate('client');
              clientForZoho = mem?.client || null;
              if (!clientForZoho) {
                clientForZoho = await Client.findById(rawCustomer);
              }
            }
          }

          console.log(`[ZohoSync] Resolved client for Zoho: ${clientForZoho?._id} (Name: ${clientForZoho?.companyName || clientForZoho?.name || clientForZoho?.firstName})`);

          // Create invoice in Zoho if linked client exists and no zoho invoice yet
          if (clientForZoho && itemForZoho?.invoice && !itemForZoho.invoice.zoho_invoice_id) {
            console.log(`[ZohoPush] Pushing invoice ${itemForZoho.invoice._id} to Zoho for client ${clientForZoho._id}`);
            const { pushInvoiceToZoho: pushToZoho } = await import('../utils/loggedZohoBooks.js');
            const zohoInvoice = await pushToZoho(itemForZoho.invoice, clientForZoho, { userId: req.user?._id, blocking: true });
            if (zohoInvoice?.invoice) {
              console.log(`[ZohoPush] ✅ Invoice synced to Zoho: ${zohoInvoice.invoice.invoice_number}`);
            }
            // Reload invoice to get zoho_invoice_id
            itemForZoho.invoice = await Invoice.findById(itemForZoho.invoice._id);
          }


          // Record customer payment in Zoho if client is linked and invoice exists in Zoho
          console.log(`[ZohoSync] Evaluating payment record. Contact ID: ${clientForZoho?.zohoBooksContactId}, Zoho Invoice ID: ${itemForZoho?.invoice?.zoho_invoice_id}`);
          if (clientForZoho?.zohoBooksContactId && itemForZoho?.invoice?.zoho_invoice_id) {
            const accessToken = await getValidAccessToken();
            const orgId = getOrgId();
            const zohoUrl = `${getBooksBaseUrl()}/customerpayments?organization_id=${orgId}`;
            const zohoPayload = {
              customer_id: clientForZoho.zohoBooksContactId,
              payment_mode: 'Razorpay',
              amount: paymentInrFloor,
              date: new Date().toISOString().slice(0, 10),
              invoices: [{ invoice_id: itemForZoho.invoice.zoho_invoice_id, amount_applied: paymentInrFloor }],
              reference_number: razorpay_payment_id,
              description: paymentNotes,
              ...(finalDepositAccountId && { account_id: finalDepositAccountId })
            };

            console.log(`[ZohoPush] Recording payment of ₹${paymentInrFloor} for Zoho invoice ${itemForZoho.invoice.zoho_invoice_id}`);
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
              console.log(`[ZohoPush] ✅ Payment recorded in Zoho: ${zohoData.payment?.payment_number}`);
              payment.zoho_payment_id = zohoData.payment?.payment_id;
              payment.payment_number = zohoData.payment?.payment_number;
              payment.zoho_status = zohoData.payment?.status;
              payment.raw_zoho_response = zohoData;
              payment.source = 'zoho_books';
              await payment.save();
              await applyInvoicePayment(invoice._id, paymentInrFloor);
              appliedViaZohoSuccess = true;
            } else {
              console.error('[ZohoPush] ❌ Zoho customer payment failed:', JSON.stringify(zohoData));
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

    if (meetingBookingId && item?.room) {
      const room = item.room;
      const startTimeStr = new Date(item.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      const endTimeStr = new Date(item.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
      const istYmd = new Date(item.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

      const responseData = {
        bookingId: item._id,
        buildingName: room.building?.name || "Ofis Square",
        buildingAddress: room.building?.address || "",
        meetingRoomName: room.name,
        floor: room.floor ? `${room.floor}${!isNaN(room.floor) ? 'th' : ''} floor` : "N/A",
        dateAndTimeSlot: `${istYmd}, ${startTimeStr} - ${endTimeStr}`,
        capacity: room.capacity,
        totalPricing: payment.amount || 0
      };

      const finalResponse = { success: true, data: responseData };
      await apiLogger.logWebhookResponse(requestId, 200, finalResponse, true);
      return res.json(finalResponse);
    }

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
            const amount = (typeof pl.amount === 'number')
              ? Number(pl.amount)
              : (pl.amount_paid || 0); // in paise

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
                        referenceNumber: rzpPaymentId,
                        currency: 'INR',
                        notes: `Razorpay ${event} • meeting_booking:${bookingId}`,
                        source: 'webhook'
                      });
                    } catch (pcErr) {
                      console.error('Failed to create local Payment from webhook:', pcErr?.message || pcErr);
                    }
                  }

                  // 3) Update local invoice totals/status
                  try { await applyInvoicePayment(booking.invoice._id, paidAmountInr); } catch (_) { }

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
                            date: new Date().toISOString().slice(0, 10),
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
                // Update booking status to booked if payment was pending (ATOMICALLY)
                const updatedBooking = await MeetingBooking.findOneAndUpdate(
                  { _id: booking._id, status: 'payment_pending' },
                  { $set: { status: 'booked' } },
                  { new: true } // Returns null if status was already booked or cancelled
                );

                if (updatedBooking) {
                  // Only run these ONE TIME, guaranteed by the atomic transition above
                  // Add reserved slot to meeting room
                  await addMeetingRoomReservedSlot(updatedBooking._id);
                  // Provision BHAiFi + Matrix access for the booked meeting timeslot
                  try { await provisionAccessForMeetingBooking({ bookingId: updatedBooking._id }); } catch (e) { console.warn('[MeetingAccess] Provision failed on webhook', e?.message); }
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

// Provisioning helper: skip Matrix/Bhaifi for Guests with pending KYC
// This is a guard to be called immediately after day pass issuance.
// Actual provisioning (Matrix/Bhaifi) will be implemented separately behind this gate.
async function maybeProvisionAfterIssuanceForDayPassId(dayPassId) {
  try {
    const pass = await DayPass.findById(dayPassId).populate('customer').lean();
    if (!pass) return;

    // If customer is a Guest and KYC is pending, skip any provisioning
    try {
      const guest = await Guest.findById(pass.customer);
      if (guest && guest.kycStatus === 'pending') {
        console.log('[Provisioning] Skipping Matrix/Bhaifi for Guest with pending KYC', {
          dayPassId: String(dayPassId),
          guestId: guest?._id ? String(guest._id) : null,
        });
        return; // gate: do not provision
      }
    } catch (_) { }

    // TODO: Add Matrix/Bhaifi provisioning here for eligible customers
    // e.g., ensureBhaifiForMember / createMatrixUserForMember
  } catch (e) {
    console.warn('[Provisioning] maybeProvisionAfterIssuanceForDayPassId error:', e?.message || e);
  }
}

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

    // Get credit wallet and its creditValue
    const wallet = await ClientCreditWallet.findOne({ client: finalClientId });
    const currentBalance = wallet?.balance || 0;
    const creditValue = wallet?.creditValue || contract?.credit_value || 500;

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
      const dayPassIds = dayPasses.map(p => p._id.toString());

      // Issue all passes in the bundle (this will create visitor records)
      await issueDayPassBatch(dayPassIds);

      // Provision per issued pass (skip if Guest KYC pending)
      for (const pid of dayPassIds) {
        try { await maybeProvisionAfterIssuanceForDayPassId(pid); } catch (_) { }
      }

      // Update bundle status
      item.status = "issued";
      await item.save();
    } else {
      // For single day pass, use the issuance service
      await issueDayPass(item._id);
      try { await maybeProvisionAfterIssuanceForDayPassId(item._id); } catch (_) { }
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

    // Sync invoice to Zoho and record payment if applicable
    if (item.invoice) {
      try {
        const inv = await Invoice.findById(item.invoice._id);
        if (inv) {
          // Resolve client for Zoho
          let clientForZoho = null;
          if (finalClientId) {
            clientForZoho = await Client.findById(finalClientId);
          }

          if (clientForZoho) {
            // Create invoice in Zoho if missing
            if (!inv.zoho_invoice_id) {
              try {
                const zohoData = await createZohoInvoiceFromLocal(inv, clientForZoho);
                if (zohoData?.invoice) {
                  inv.zoho_invoice_id = zohoData.invoice.invoice_id;
                  inv.zoho_invoice_number = zohoData.invoice.invoice_number;
                  inv.source = 'zoho';
                  await inv.save();
                }
              } catch (e) {
                console.warn('[payWithCredits] Zoho invoice creation failed:', e.message);
              }
            }

            // Record payment in Zoho
            if (inv.zoho_invoice_id && clientForZoho.zohoBooksContactId) {
              try {
                const zohoPayload = {
                  customer_id: clientForZoho.zohoBooksContactId,
                  payment_mode: 'Credits',
                  amount: totalAmount,
                  date: new Date().toISOString().slice(0, 10),
                  invoices: [{ invoice_id: inv.zoho_invoice_id, amount_applied: totalAmount }],
                  reference_number: payment.referenceNumber,
                  description: payment.notes
                };
                const zohoResp = await recordZohoPayment(inv.zoho_invoice_id, zohoPayload);
                if (zohoResp?.payment) {
                  payment.zoho_payment_id = zohoResp.payment.payment_id;
                  payment.payment_number = zohoResp.payment.payment_number;
                  payment.zoho_status = zohoResp.payment.status;
                  payment.raw_zoho_response = zohoResp;
                  payment.source = 'zoho_books';
                  await payment.save();
                }
              } catch (e) {
                console.warn('[payWithCredits] Zoho payment recording failed:', e.message);
              }
            }
          }

          // Apply locally
          await applyInvoicePayment(inv._id, totalAmount);
        }
      } catch (zohoErr) {
        console.error("[payWithCredits] Zoho sync error:", zohoErr);
      }
    }

    // Re-fetch item to get updated status and populated fields
    let updatedItem;
    if (dayPassId) {
      updatedItem = await DayPass.findById(dayPassId).populate('building').populate('invoice');
    } else {
      updatedItem = await DayPassBundle.findById(bundleId).populate('building').populate('invoice');
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
      item: updatedItem,
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

    // Get credit wallet and its creditValue
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    const balance = wallet?.balance || 0;
    const creditValue = wallet?.creditValue || contract?.building?.creditValue || 500;

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

    // Get credit wallet and its creditValue
    const wallet = await ClientCreditWallet.findOne({ client: clientId });
    const balance = wallet?.balance || 0;
    const creditValue = wallet?.creditValue || contract?.building?.creditValue || 500;

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
      date: date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
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
      try { await Client.findByIdAndUpdate(payment.client._id, { $inc: { extra_credits: -refundAmount } }); } catch (_) { }
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

    const refundAmount = Number(amount);
    if (refundAmount > Number(payment.unused_amount || 0)) {
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
    } catch (_) { }

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
      } catch (_) { }

      const alloc = Math.min(need, payUnused);
      if (alloc <= 0.009) continue;

      // Only update the selected invoice in Zoho payload (do not include other invoices)
      const prevForTarget = (existingAllocations.find(a => a.invoice_id === zohoInvoiceId)?.amount_applied) || 0;
      const newInvoices = [{ invoice_id: zohoInvoiceId, amount_applied: Math.round((prevForTarget + alloc) * 100) / 100 }];

      // Debug: log the payload that will be sent to Zoho
      try {
        console.log('[applyExcessPaymentToInvoice] payment:', pay.zoho_payment_id);
        console.log('[applyExcessPaymentToInvoice] PUT payload:', JSON.stringify({ invoices: newInvoices }, null, 2));
      } catch (_) { }

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
      } catch (_) { }
      await pay.save();

      // Update client extra_credits down by alloc
      try { await Client.findByIdAndUpdate(paymentClientId, { $inc: { extra_credits: -alloc } }); } catch (_) { }

      // Update local invoice
      await updateInvoiceAfterZohoPayment(invoiceId, alloc);
      try { await applyPaymentToDeposit(invoiceId, alloc); } catch (_) { }

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
      } catch (_) { }
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
    const invClientId = invoice?.client?._id
      ? invoice.client._id.toString()
      : (invoice?.client && typeof invoice.client.toString === 'function' ? invoice.client.toString() : null);
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
    } catch (_) { }

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
      } catch (_) { }

      const alloc = Math.min(need, payUnused);
      if (alloc <= 0.009) continue;

      // Only update the selected invoice in Zoho payload (do not include other invoices)
      const prevForTarget = (existingAllocations.find(a => a.invoice_id === zohoInvoiceId)?.amount_applied) || 0;
      const newInvoices = [{ invoice_id: zohoInvoiceId, amount_applied: Math.round((prevForTarget + alloc) * 100) / 100 }];

      // Debug: log the payload that will be sent to Zoho
      try {
        console.log('[applyAllCreditsToInvoice] payment:', pay.zoho_payment_id);
        console.log('[applyAllCreditsToInvoice] PUT payload:', JSON.stringify({ invoices: newInvoices }, null, 2));
      } catch (_) { }

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
      } catch (_) { }
      await pay.save();

      // Update client extra_credits down by alloc
      try { await Client.findByIdAndUpdate(clientId, { $inc: { extra_credits: -alloc } }); } catch (_) { }

      // Update local invoice
      await updateInvoiceAfterZohoPayment(invoiceId, alloc);
      try { await applyPaymentToDeposit(invoiceId, alloc); } catch (_) { }

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
      } catch (_) { }
    }

    const leftover = Math.max(0, Math.round(need * 100) / 100);
    return res.json({ success: true, data: { invoiceId, allocated: totalAllocated, leftover, allocations } });

  } catch (error) {
    await logErrorActivity(req, error, 'Apply All Credits to Invoice');
    return res.status(500).json({ success: false, message: error.message });
  }
};