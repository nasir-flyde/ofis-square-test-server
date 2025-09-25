import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import DayPass from "../models/dayPassModel.js";
import DayPassBundle from "../models/dayPassBundleModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Contract from "../models/contractModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import { issueDayPass, issueDayPassBatch } from "../services/dayPassIssuanceService.js";
import { getValidAccessToken } from '../utils/zohoTokenManager.js';
import crypto from 'crypto';
import { logPaymentActivity, logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// Helper: update invoice aggregates after a payment change
async function applyInvoicePayment(invoiceId, deltaAmount) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  const amountPaid = Math.max(0, Number(invoice.amountPaid || 0) + Number(deltaAmount || 0));
  invoice.amountPaid = Math.round(amountPaid * 100) / 100;
  const balanceDue = Math.max(0, Number(invoice.total || 0) - invoice.amountPaid);
  invoice.balanceDue = Math.round(balanceDue * 100) / 100;

  if (invoice.balanceDue === 0) {
    invoice.status = "paid";
  } else if (invoice.status !== "void") {
    // keep overdue if already overdue, else issued
    const now = new Date();
    if (invoice.dueDate && now > new Date(invoice.dueDate)) {
      invoice.status = "overdue";
    } else if (invoice.status === "draft") {
      invoice.status = "issued";
    } else if (!invoice.status || invoice.status === "issued") {
      invoice.status = "issued";
    }
  }

  await invoice.save();
  return invoice;
}

// POST /api/payments
export const createPayment = async (req, res) => {
  try {
    const { invoice: invoiceId, client, amount, paymentDate, type, referenceNumber, paymentGatewayRef, currency, notes, bankName, accountNumber } = req.body || {};

    if (!invoiceId) return res.status(400).json({ success: false, message: "invoice is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount must be > 0" });
    if (!paymentDate) return res.status(400).json({ success: false, message: "paymentDate is required" });

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // If client is provided, optionally validate matches invoice client
    if (client && String(client) !== String(invoice.client)) {
      return res.status(400).json({ success: false, message: "Payment client does not match invoice client" });
    }

    const payment = await Payment.create({
      invoice: invoiceId,
      client: client || invoice.client,
      type: type || undefined, // defaults to schema default
      referenceNumber: referenceNumber || undefined,
      paymentGatewayRef: paymentGatewayRef || undefined,
      amount: Number(amount),
      paymentDate: new Date(paymentDate),
      currency: currency || undefined,
      notes: notes || undefined,
      bankName: bankName || undefined,
      accountNumber: accountNumber || undefined,
    });

    const updatedInvoice = await applyInvoicePayment(invoiceId, Number(amount));

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_MADE', 'Payment', payment._id, {
      invoiceId,
      amount: Number(amount),
      paymentType: type,
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
      .populate("invoice", "invoice_number total amountPaid balanceDue status dueDate")
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
      .populate("invoice", "invoice_number total amountPaid balanceDue status dueDate")
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
      .populate("invoice", "invoice_number total amountPaid balanceDue status dueDate building cabin")
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
async function updateInvoiceAfterZohoPayment(invoiceId, amountApplied) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return;

  const newAmountPaid = Math.max(0, Number(invoice.amount_paid || 0) + Number(amountApplied));
  const newBalance = Math.max(0, Number(invoice.total || 0) - newAmountPaid);
  
  invoice.amount_paid = newAmountPaid;
  invoice.balance = newBalance;
  
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

  // Add billing address if available
  if (invoice.billing_address && Object.keys(invoice.billing_address).length > 0) {
    zohoInvoicePayload.billing_address = invoice.billing_address;
  }

  // Add shipping address if available
  if (invoice.shipping_address && Object.keys(invoice.shipping_address).length > 0) {
    zohoInvoicePayload.shipping_address = invoice.shipping_address;
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
    if (!clientId || !invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Client ID and invoices array are required'
      });
    }

    if (!amount || !date) {
      return res.status(400).json({
        success: false,
        message: 'Amount and date are required'
      });
    }

    // Validate amount allocation
    const totalAllocated = invoices.reduce((sum, inv) => sum + Number(inv.amount_applied), 0);
    if (Math.abs(totalAllocated - Number(amount)) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Total allocated amount (${totalAllocated}) must equal payment amount (${amount})`
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
    const invoiceIds = invoices.map(inv => inv.invoiceId);
    const dbInvoices = await Invoice.find({ _id: { $in: invoiceIds } });
    
    if (dbInvoices.length !== invoices.length) {
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

    // Validate payment amounts don't exceed outstanding balances
    for (const paymentInv of invoices) {
      const dbInvoice = dbInvoices.find(inv => inv._id.toString() === paymentInv.invoiceId);
      const outstanding = dbInvoice.balance || dbInvoice.total;
      if (Number(paymentInv.amount_applied) > outstanding) {
        return res.status(400).json({
          success: false,
          message: `Payment amount (${paymentInv.amount_applied}) exceeds outstanding balance (${outstanding}) for invoice ${dbInvoice.invoice_number}`
        });
      }
    }

    // Prepare Zoho Books payload
    const zohoPayload = {
      customer_id: client.zohoBooksContactId,
      payment_mode,
      amount: Number(amount),
      date,
      invoices: invoices.map(inv => {
        const dbInvoice = dbInvoices.find(dbInv => dbInv._id.toString() === inv.invoiceId);
        return {
          invoice_id: dbInvoice.zoho_invoice_id,
          amount_applied: Number(inv.amount_applied)
        };
      }),
      reference_number: reference_number || '',
      description: description || `Payment for ${invoices.length} invoice(s)`
    };

    if (deposit_to_account_id) {
      zohoPayload.deposit_to_account_id = deposit_to_account_id;
    }

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

    // Create local payment record
    const paymentData = {
      client: finalClientId,
      invoices: invoices.map(inv => {
        const dbInvoice = dbInvoices.find(dbInv => dbInv._id.toString() === inv.invoiceId);
        return {
          invoice: inv.invoiceId,
          amount_applied: Number(inv.amount_applied),
          zoho_invoice_id: dbInvoice.zoho_invoice_id
        };
      }),
      type: payment_mode,
      amount: Number(amount),
      paymentDate: new Date(date),
      referenceNumber: reference_number,
      notes: description,
      currency: 'INR',
      
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
    if (invoices.length === 1) {
      paymentData.invoice = invoices[0].invoiceId;
    }

    const payment = await Payment.create(paymentData);

    // Update local invoice balances
    for (const inv of invoices) {
      await updateInvoiceAfterZohoPayment(inv.invoiceId, inv.amount_applied);
    }

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_PROCESSED', 'Payment', payment._id, {
      zohoPaymentId: zohoData.payment?.payment_id,
      clientId,
      amount: Number(amount),
      invoiceCount: invoices.length,
      paymentMode: payment_mode
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

// Razorpay payment integration for day passes
export const createRazorpayOrder = async (req, res) => {
  try {
    const { dayPassId, bundleId } = req.body;

    if (!dayPassId && !bundleId) {
      return res.status(400).json({ error: "Day pass ID or Bundle ID is required" });
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
    } else {
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
    }
    
    res.json({
      success: true,
      razorpayKey: process.env.RAZORPAY_KEY_ID || "rzp_test_02U4mUmreLeYrU",
      amount: amount * 100, // Convert to paise
      currency: "INR",
      item,
      buildingName,
      description
    });
  } catch (error) {
    console.error("createRazorpayOrder error:", error);
    await logErrorActivity(req, error, 'Create Razorpay Order');
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Handle Razorpay payment success
export const handleRazorpaySuccess = async (req, res) => {
  try {
    const { 
      razorpay_payment_id, 
      dayPassId,
      bundleId, 
      amount 
    } = req.body;

    if (!razorpay_payment_id || (!dayPassId && !bundleId)) {
      return res.status(400).json({ error: "Payment ID and Day Pass ID or Bundle ID are required" });
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
    } else {
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
    }

    // Determine customer type and set appropriate payment fields
    let paymentData = {
      invoice: invoice?._id,
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

    // Create payment record
    const payment = new Payment(paymentData);
    await payment.save();

    // Log payment activity
    await logPaymentActivity(req, 'PAYMENT_PROCESSED', 'Payment', payment._id, {
      razorpayPaymentId: razorpay_payment_id,
      amount: amount / 100,
      itemType: dayPassId ? 'daypass' : 'bundle',
      itemId: dayPassId || bundleId
    });

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

    // Update invoice if exists
    if (invoice) {
      await applyInvoicePayment(invoice._id, amount / 100);
    }

    const responseMessage = dayPassId 
      ? "Payment successful, day pass issued"
      : "Payment successful, bundle and day passes issued";

    res.json({
      success: true,
      message: responseMessage,
      item,
      payment: {
        id: payment._id,
        razorpay_payment_id,
        amount: payment.amount,
        status: "completed"
      }
    });
  } catch (error) {
    console.error("handleRazorpaySuccess error:", error);
    console.error("Error stack:", error.stack);
    await logErrorActivity(req, error, 'Handle Razorpay Success');
    res.status(500).json({ 
      error: "Internal Server Error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Razorpay webhook handler for payment status updates
export const handleRazorpayWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;
    
    // Verify webhook signature if needed
    // const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    //   .update(JSON.stringify(req.body))
    //   .digest('hex');
    
    console.log('Razorpay webhook received:', event);
    
    if (event === 'payment.captured' || event === 'payment.authorized') {
      const paymentId = payload.payment?.entity?.id;
      const amount = payload.payment?.entity?.amount;
      
      if (paymentId) {
        // Find existing payment record by gateway reference
        const existingPayment = await Payment.findOne({
          paymentGatewayRef: paymentId
        });
        
        if (existingPayment) {
          console.log('Payment already processed:', paymentId);
          return res.status(200).json({ status: 'already_processed' });
        }
        
        // Find day pass by payment reference (if stored during order creation)
        // For now, we'll log the webhook for manual processing
        console.log('Webhook payment details:', {
          paymentId,
          amount: amount / 100,
          status: payload.payment?.entity?.status
        });
        
        // TODO: Implement automatic day pass status update based on payment ID
        // This would require storing payment ID during order creation
      }
    }
    
    res.status(200).json({ status: 'received' });
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    await logErrorActivity(req, error, 'Razorpay Webhook');
    res.status(500).json({ error: 'Webhook processing failed' });
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
    const creditValue = contract.credit_value || 500;

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
    const creditValue = contract.credit_value || 500;

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
