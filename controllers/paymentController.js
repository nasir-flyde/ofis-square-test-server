import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import { getValidAccessToken } from '../utils/zohoTokenManager.js';
import crypto from 'crypto';

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

    return res.status(201).json({ success: true, data: { payment, invoice: updatedInvoice } });
  } catch (error) {
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

    return res.json({ success: true, message: "Payment deleted successfully", deletedPaymentId: id });
  } catch (error) {
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
      client: clientId,
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
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list customer payments'
    });
  }
};
