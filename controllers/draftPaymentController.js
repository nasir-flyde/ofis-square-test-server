import mongoose from "mongoose";
import DraftPayment from "../models/draftPaymentModel.js";
import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import imagekit from "../utils/imageKit.js";

// Helper: apply amount delta to invoice and set status fields
async function applyInvoicePayment(invoiceId, deltaAmount) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  const amountPaid = Math.max(0, Number(invoice.amountPaid || 0) + Number(deltaAmount || 0));
  invoice.amountPaid = Math.round(amountPaid * 100) / 100;
  const balanceDue = Math.max(0, Number(invoice.total || 0) - invoice.amountPaid);
  invoice.balanceDue = Math.round(balanceDue * 100) / 100;

  if (invoice.balanceDue === 0) {
    invoice.status = "paid";
    invoice.paidAt = invoice.paidAt || new Date();
  } else if (invoice.status !== "void") {
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

export const createDraftPayment = async (req, res) => {
  try {
    const { invoice: invoiceId, client, amount, paymentDate, type, referenceNumber, currency, notes, screenshots } = req.body || {};

    if (!invoiceId) return res.status(400).json({ success: false, message: "invoice is required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount must be > 0" });
    if (!paymentDate) return res.status(400).json({ success: false, message: "paymentDate is required" });

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const submittingClient = req.clientId || client || invoice.client;
    
    // Handle file uploads to ImageKit
    let screenshotUrls = [];
    if (req.files && req.files.length > 0) {
      const folder = process.env.IMAGEKIT_PAYMENT_FOLDER || "/ofis-square/payments";
      const uploadPromises = req.files.map(async (file) => {
        try {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `payment_${Date.now()}_${file.originalname}`,
            folder,
          });
          return result.url;
        } catch (error) {
          console.error('ImageKit upload error:', error);
          throw new Error(`Failed to upload ${file.originalname}`);
        }
      });
      screenshotUrls = await Promise.all(uploadPromises);
    } else if (screenshots && Array.isArray(screenshots)) {
      // Handle base64 screenshots (fallback)
      screenshotUrls = screenshots;
    }

    const draft = await DraftPayment.create({
      invoice: invoiceId,
      client: submittingClient,
      type: type || undefined,
      referenceNumber: referenceNumber || undefined,
      amount: Number(amount),
      paymentDate: new Date(paymentDate),
      currency: currency || undefined,
      notes: notes || undefined,
      screenshots: screenshotUrls,
      status: "pending",
      submittedByClient: req.clientId || undefined,
    });

    return res.status(201).json({ success: true, data: draft });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveDraftPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { reviewNote } = req.body || {};

    const draft = await DraftPayment.findById(id).session(session);
    if (!draft) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Draft payment not found" });
    }

    if (draft.status === "approved") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Draft already approved" });
    }
    if (draft.status === "rejected") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Draft already rejected" });
    }

    // Create real Payment
    const payment = await Payment.create([
      {
        invoice: draft.invoice,
        client: draft.client,
        type: draft.type || undefined,
        referenceNumber: draft.referenceNumber || undefined,
        amount: Number(draft.amount),
        paymentDate: draft.paymentDate,
        currency: draft.currency || undefined,
        notes: draft.notes || undefined,
        screenshots: draft.screenshots || [], // Transfer screenshots from draft
      },
    ], { session });

    // Update invoice totals
    await applyInvoicePayment(draft.invoice, Number(draft.amount));

    // Update draft status
    draft.status = "approved";
    draft.reviewedBy = req.user?._id;
    draft.reviewNote = reviewNote || undefined;
    draft.reviewedAt = new Date();
    await draft.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, message: "Draft approved and payment recorded", data: { draft, payment: payment?.[0] } });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/draft-payments/:id/reject
// Access: admin (authMiddleware)
export const rejectDraftPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body || {};

    const draft = await DraftPayment.findById(id);
    if (!draft) return res.status(404).json({ success: false, message: "Draft payment not found" });
    if (!reviewNote) return res.status(400).json({ success: false, message: "reviewNote is required to reject" });
    if (draft.status === "approved") return res.status(400).json({ success: false, message: "Already approved" });

    draft.status = "rejected";
    draft.reviewedBy = req.user?._id;
    draft.reviewNote = reviewNote;
    draft.reviewedAt = new Date();
    await draft.save();

    return res.json({ success: true, data: draft });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/draft-payments
// Access: admin (authMiddleware) or client (will only see own)
export const getDraftPayments = async (req, res) => {
  try {
    const { status, invoice, client } = req.query || {};
    const filter = {};
    if (status) filter.status = status;
    if (invoice) filter.invoice = invoice;

    // If clientMiddleware exposed clientId and role isn't admin, filter by that client
    const roleName = req.userRole?.roleName || req.user?.roleName;
    if (roleName && String(roleName).toLowerCase() !== "admin") {
      if (req.clientId) filter.client = req.clientId;
    } else if (client) {
      filter.client = client;
    }

    const drafts = await DraftPayment.find(filter)
      .populate("invoice", "invoiceNumber total amountPaid balanceDue status dueDate")
      .populate("client", "companyName contactPerson email phone")
      .populate("submittedByClient", "companyName contactPerson")
      .populate("reviewedBy", "name email")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: drafts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/draft-payments/:id
export const getDraftPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const draft = await DraftPayment.findById(id)
      .populate("invoice", "invoiceNumber total amountPaid balanceDue status dueDate")
      .populate("client", "companyName contactPerson email phone")
      .populate("submittedByClient", "companyName contactPerson")
      .populate("reviewedBy", "name email");
    if (!draft) return res.status(404).json({ success: false, message: "Draft payment not found" });

    // If non-admin, ensure access
    const roleName = req.userRole?.roleName || req.user?.roleName;
    if (roleName && String(roleName).toLowerCase() !== "admin") {
      if (req.clientId && String(draft.client) !== String(req.clientId)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    return res.json({ success: true, data: draft });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
