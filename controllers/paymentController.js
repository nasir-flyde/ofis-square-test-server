import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";

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
      .populate("invoice", "invoiceNumber total amountPaid balanceDue status dueDate")
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
      .populate("invoice", "invoiceNumber total amountPaid balanceDue status dueDate")
      .populate("client", "companyName contactPerson phone email");
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.json({ success: true, data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
