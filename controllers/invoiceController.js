import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import PdfPrinter from "pdfmake";
import getInvoiceTemplate from "./invoiceTemplate.js";
import {
  createZohoInvoiceFromLocal,
  getZohoInvoice,
  getZohoInvoicePdfUrl,
  recordZohoPayment,
  sendZohoInvoiceEmail,
} from "../utils/zohoBooks.js";

async function generateLocalInvoiceNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `INV-${yyyy}-${mm}-`;

  const latest = await Invoice.findOne({ invoice_number: { $regex: `^${prefix}` } })
    .sort({ createdAt: -1 })
    .lean();

  let nextSeq = 1;
  if (latest && latest.invoice_number) {
    const parts = latest.invoice_number.split("-");
    const seqStr = parts[3];
    const seq = Number(seqStr);
    if (!Number.isNaN(seq)) nextSeq = seq + 1;
  }

  const suffix = String(nextSeq).padStart(4, "0");
  return `${prefix}${suffix}`;
}

function computeTotals(payload) {
  const items = (payload.items || []).map((it) => {
    const quantity = Number(it.quantity || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    return { description: it.description, quantity, unitPrice, amount };
  });
  const subtotal = Math.round(items.reduce((sum, i) => sum + Number(i.amount || 0), 0) * 100) / 100;

  const discount = payload.discount || { type: "flat", value: 0 };
  let discountAmount = 0;
  if (discount.type === "percent") {
    discountAmount = Math.round(((subtotal * Number(discount.value || 0)) / 100) * 100) / 100;
  } else {
    discountAmount = Number(discount.value || 0);
  }
  if (discountAmount < 0) discountAmount = 0;
  if (discountAmount > subtotal) discountAmount = subtotal;

  const taxableBase = subtotal - discountAmount;

  const taxes = (payload.taxes || []).map((t) => {
    const rate = Number(t.rate || 0);
    const amount = Math.round(((taxableBase * rate) / 100) * 100) / 100;
    return { name: t.name, rate, amount };
  });
  const taxesTotal = Math.round(taxes.reduce((sum, t) => sum + Number(t.amount || 0), 0) * 100) / 100;

  const total = Math.max(0, Math.round((taxableBase + taxesTotal) * 100) / 100);
  const amountPaid = Number(payload.amountPaid || 0);
  const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);

  return {
    items,
    subtotal,
    discount: { type: discount.type || "flat", value: Number(discount.value || 0), amount: discountAmount },
    taxes,
    total,
    amountPaid,
    balanceDue,
  };
}

export const createInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    const { client, contract, building, cabin, billingPeriod, issueDate, dueDate, notes, meta } = body;

    if (!client) return res.status(400).json({ success: false, message: "client is required" });
    if (!billingPeriod || !billingPeriod.start || !billingPeriod.end) {
      return res.status(400).json({ success: false, message: "billingPeriod.start and billingPeriod.end are required" });
    }

    const [clientDoc, contractDoc, buildingDoc, cabinDoc] = await Promise.all([
      Client.findById(client),
      contract ? Contract.findById(contract) : Promise.resolve(null),
      building ? Building.findById(building) : Promise.resolve(null),
      cabin ? Cabin.findById(cabin) : Promise.resolve(null),
    ]);
    if (!clientDoc) return res.status(404).json({ success: false, message: "Client not found" });
    if (contract && !contractDoc) return res.status(404).json({ success: false, message: "Contract not found" });
    if (building && !buildingDoc) return res.status(404).json({ success: false, message: "Building not found" });
    if (cabin && !cabinDoc) return res.status(404).json({ success: false, message: "Cabin not found" });

    const localInvoiceNumber = body.localInvoiceNumber || (await generateLocalInvoiceNumber());
    const totals = computeTotals(body);

    const invoice = await Invoice.create({
      invoice_number: localInvoiceNumber,
      client,
      contract: contract || undefined,
      building: building || undefined,
      cabin: cabin || undefined,
      date: issueDate ? new Date(issueDate) : new Date(),
      due_date: dueDate ? new Date(dueDate) : undefined,
      billing_period: {
        start: new Date(billingPeriod.start),
        end: new Date(billingPeriod.end),
      },
      
      line_items: totals.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        name: item.description,
        rate: item.unitPrice,
        unit: "nos",
        item_total: item.amount
      })),
      
      sub_total: totals.subtotal,
      discount: totals.discount.amount,
      discount_type: totals.discount.type,
      tax_total: totals.taxes.reduce((sum, t) => sum + t.amount, 0),
      total: totals.total,
      amount_paid: totals.amountPaid,
      balance: totals.balanceDue,
      status: body.status || "draft",
      notes: notes || "",
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: clientDoc.gstTreatment || "business_gst",
      place_of_supply: "MH",
      payment_terms: 30,
      payment_terms_label: "Net 30",
      
      ...(clientDoc.billingAddress && {
        billing_address: {
          attention: clientDoc.contactPerson,
          address: clientDoc.billingAddress.address,
          city: clientDoc.billingAddress.city,
          state: clientDoc.billingAddress.state,
          zip: clientDoc.billingAddress.zip,
          country: clientDoc.billingAddress.country || "IN",
          phone: clientDoc.phone
        }
      }),
      
      customer_id: clientDoc.zohoBooksContactId,
      gst_no: clientDoc.gstNo,
      
      ...(meta ? { meta } : {}),
    });
    console.log(`Manual invoice ${invoice._id} created locally with number ${localInvoiceNumber}. Will be auto-pushed to Zoho Books during payment processing.`);

    return res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate local invoice number or Zoho invoice ID" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

function getFonts() {
  return {
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique'
    }
  };
}

export const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id)
      .populate('client', 'companyName contactPerson email phone companyAddress')
      .lean();

    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const data = {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      client: invoice.client || {},
      billingPeriod: invoice.billingPeriod || {},
      items: invoice.items || [],
      subtotal: invoice.subtotal || 0,
      discount: invoice.discount || { type: 'flat', value: 0, amount: 0 },
      taxes: invoice.taxes || [],
      total: invoice.total || 0,
      amountPaid: invoice.amountPaid || 0,
      balanceDue: invoice.balanceDue || 0,
      notes: invoice.notes || ''
    };

    const docDefinition = getInvoiceTemplate(data);
    const printer = new PdfPrinter(getFonts());
    const pdfDoc = printer.createPdfKitDocument(docDefinition, { defaultStyle: { font: 'Helvetica' } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoiceNumber || id}.pdf"`);

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('downloadInvoicePdf error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const pushInvoiceToZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (invoice.zoho_invoice_id) {
      return res.json({ 
        success: true, 
        data: invoice, 
        message: "Invoice already linked to Zoho Books",
        zoho_invoice_id: invoice.zoho_invoice_id
      });
    }

    return res.status(200).json({
      success: true,
      message: "Manual push deprecated. Invoice will be automatically created in Zoho Books during payment processing.",
      recommendation: "Use POST /api/payments/zoho-customer-payment to record payments - invoices are auto-created in Zoho.",
      invoice_id: invoice._id,
      invoice_number: invoice.invoice_number
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const sendInvoiceEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, customMessage } = req.body || {};
    const invoice = await Invoice.findById(id).populate("client", "email");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const payload = { to: to || invoice?.client?.email, subject, body: customMessage };
    const resp = await sendZohoInvoiceEmail(invoice.zoho_invoice_id, payload);
    invoice.sentAt = new Date();
    invoice.zohoStatus = "sent";
    await invoice.save();
    return res.json({ success: true, data: invoice, zoho: resp });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

export const syncInvoiceFromZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const zInv = await getZohoInvoice(invoice.zoho_invoice_id);
    if (zInv) {
      invoice.zohoStatus = zInv.status || zInv.status_formatted || invoice.zohoStatus;
      invoice.zohoPdfUrl = zInv.pdf_url || invoice.zohoPdfUrl;
      invoice.invoiceUrl = zInv.invoice_url || invoice.invoiceUrl;
      if (typeof zInv.balance === "number" && typeof zInv.total === "number") {
        invoice.amountPaid = Math.max(0, Number(zInv.total) - Number(zInv.balance));
        invoice.balanceDue = Number(zInv.balance);
        if (invoice.balanceDue === 0) invoice.paidAt = invoice.paidAt || new Date();
        invoice.status = invoice.balanceDue === 0 ? "paid" : invoice.status;
      }
      await invoice.save();
    }
    return res.json({ success: true, data: invoice, zoho: zInv });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

export const getInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const url = await getZohoInvoicePdfUrl(invoice.zoho_invoice_id);
    return res.json({ success: true, data: { pdfUrl: url } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

// POST /api/invoices/:id/payments
export const recordInvoicePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, payment_mode, reference_number } = req.body || {};
    if (!amount) return res.status(400).json({ success: false, message: "amount is required" });
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const payment = await recordZohoPayment(invoice.zoho_invoice_id, { amount, date, payment_mode, reference_number });
    invoice.amountPaid = Number(invoice.amountPaid || 0) + Number(amount);
    invoice.balanceDue = Math.max(0, Number(invoice.total || 0) - Number(invoice.amountPaid || 0));
    if (invoice.balanceDue === 0) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
    }
    invoice.paymentId = payment?.payment_id || invoice.paymentId;
    await invoice.save();

    return res.json({ success: true, data: invoice, zoho: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

// POST /api/invoices/webhook/zoho
export const zohoWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    const event = payload.event_type || payload.event || payload.action;
    const data = payload.data || payload.payload || {};

    // Handle invoice creation from Zoho Books side
    if (event === "invoice_created" && data.invoice) {
      const zohoInvoiceId = data.invoice.invoice_id;
      const zohoInvoiceNumber = data.invoice.invoice_number;
      
      if (zohoInvoiceId) {
        // Check if we already have this invoice
        const existingInvoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        
        if (!existingInvoice) {
          // Create new invoice from Zoho data
          const newInvoice = await Invoice.create({
            invoice_number: zohoInvoiceNumber,
            zoho_invoice_id: zohoInvoiceId,
            zoho_invoice_number: zohoInvoiceNumber,
            source: 'webhook',
            customer_id: data.invoice.customer_id,
            date: new Date(data.invoice.date),
            due_date: data.invoice.due_date ? new Date(data.invoice.due_date) : undefined,
            sub_total: data.invoice.sub_total || 0,
            discount: data.invoice.discount || 0,
            tax_total: data.invoice.tax_total || 0,
            total: data.invoice.total || 0,
            balance: data.invoice.balance || data.invoice.total || 0,
            amount_paid: data.invoice.amount_paid || 0,
            status: data.invoice.status === 'paid' ? 'paid' : 'issued',
            currency_code: data.invoice.currency_code || 'INR',
            notes: data.invoice.notes || '',
            line_items: (data.invoice.line_items || []).map(item => ({
              description: item.description || item.name,
              quantity: item.quantity || 1,
              unitPrice: item.rate || 0,
              amount: item.item_total || 0,
              name: item.name,
              rate: item.rate,
              unit: item.unit || 'nos',
              item_total: item.item_total
            }))
          });
          
          console.log(`✅ Created new invoice from Zoho webhook: ${zohoInvoiceNumber}`);
        }
      }
    }

    // Handle payment events
    if (event === "invoice_payment_made" || event === "payment_created") {
      const zohoInvoiceId = data.invoice_id || data.invoice?.invoice_id;
      const amount = Number(data.amount || data.paid_amount || 0);
      if (zohoInvoiceId) {
        const invoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        if (invoice) {
          invoice.amount_paid = Math.max(0, Number(invoice.amount_paid || 0) + amount);
          invoice.balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));
          if (invoice.balance === 0) {
            invoice.status = "paid";
            invoice.paid_at = new Date();
          }
          await invoice.save();
        }
      }
    }

    // Handle status updates
    if (event === "invoice_status_changed" || event === "invoice_sent") {
      const zohoInvoiceId = data.invoice_id || data.invoice?.invoice_id;
      if (zohoInvoiceId) {
        const invoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        if (invoice) {
          invoice.zoho_status = data.status || data.invoice?.status || invoice.zoho_status;
          if (event === "invoice_sent") invoice.sent_at = new Date();
          await invoice.save();
        }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Zoho webhook error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const getInvoices = async (req, res) => {
  try {
    const { client, contract, status, from, to } = req.query || {};
    const filter = {};
    if (client) filter.client = client;
    if (contract) filter.contract = contract;
    if (status) filter.status = status;
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }

    const invoices = await Invoice.find(filter)
      .populate("client", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: invoices });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/invoices/:id
export const getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id)
      .populate("client", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("building", "name city")
      .populate("cabin", "number floor");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.json({ success: true, data: invoice });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/invoices/:id/status
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amountPaid } = req.body || {};
    if (!status) return res.status(400).json({ success: false, message: "status is required" });

    const allowed = ["draft", "issued", "paid", "overdue", "void"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    if (typeof amountPaid === "number") {
      invoice.amountPaid = amountPaid;
      invoice.balanceDue = Math.max(0, Number(invoice.total || 0) - Number(invoice.amountPaid || 0));
    }

    invoice.status = status;
    await invoice.save();

    return res.json({ success: true, data: invoice });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
// DELETE /api/invoices/:id
export const deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    // Prevent deleting invoices that have payments
    const paymentCount = await Payment.countDocuments({ invoice: id });
    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete invoice with existing payments. Please delete related payments first.",
      });
    }

    await Invoice.findByIdAndDelete(id);
    return res.json({ success: true, message: "Invoice deleted successfully", deletedInvoiceId: id });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};