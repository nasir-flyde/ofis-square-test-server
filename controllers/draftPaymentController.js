import mongoose from "mongoose";
import DraftPayment from "../models/draftPaymentModel.js";
import Payment from "../models/paymentModel.js";
import Invoice from "../models/invoiceModel.js";
import imagekit from "../utils/imageKit.js";
import { recordZohoPayment } from "../utils/zohoBooks.js";
import { sendNotification } from "../utils/notificationHelper.js";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";

// Helper: apply amount delta to invoice and set status fields (aligned with current model)
async function applyInvoicePayment(invoiceId, deltaAmount) {
  const invoice = await Invoice.findById(invoiceId).populate('client').populate('building');
  if (!invoice) throw new Error("Invoice not found");

  const newAmountPaid = Math.max(0, Number(invoice.amount_paid || 0) + Number(deltaAmount || 0));
  const newBalance = Math.max(0, Number(invoice.total || 0) - newAmountPaid);

  invoice.amount_paid = Math.round(newAmountPaid * 100) / 100;
  invoice.balance = Math.round(newBalance * 100) / 100;

  if (invoice.balance === 0) {
    invoice.status = "paid";
    invoice.paid_at = new Date();
  } else if (invoice.amount_paid > 0) {
    invoice.status = "partially_paid";
  }

  invoice.last_payment_date = new Date();
  await invoice.save();
  return invoice;
}

// Helper: map payment types to Zoho Books payment modes
function getZohoPaymentMode(paymentType) {
  const modeMap = {
    'cash': 'cash',
    'check': 'check',
    'cheque': 'check',
    'bank_transfer': 'banktransfer',
    'wire_transfer': 'banktransfer',
    'credit_card': 'creditcard',
    'debit_card': 'creditcard',
    'upi': 'banktransfer',
    'online': 'banktransfer',
    'neft': 'banktransfer',
    'rtgs': 'banktransfer',
    'imps': 'banktransfer'
  };

  return modeMap[paymentType?.toLowerCase()] || 'banktransfer';
}
export const createDraftPayment = async (req, res) => {
  try {
    const {
      invoice: invoiceId,
      client,
      amount,
      paymentDate,
      type,
      referenceNumber,
      currency,
      notes,
      screenshots
    } = req.body || {};

    const userRole = req.userRole?.roleName || "";
    if (userRole === "finance_junior") {
      console.log(
        `Finance Junior ${req.user?.name || "user"} creating draft payment (approval required)`
      );
    }

    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: "amount must be > 0" });

    if (!paymentDate)
      return res.status(400).json({ success: false, message: "paymentDate is required" });

    let invoice = null;
    if (invoiceId) {
      invoice = await Invoice.findById(invoiceId);
      if (!invoice)
        return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    const submittingClient = req.clientId || client || invoice?.client;
    if (!submittingClient) {
      return res.status(400).json({ success: false, message: "Client is required when no invoice is tagged" });
    }

    let screenshotUrls = [];

    if (req.files && req.files.length > 0) {
      const folder = process.env.IMAGEKIT_PAYMENT_FOLDER || "/ofis-square/payments";

      const uploadPromises = req.files.map(async (file) => {
        try {
          const result = await imagekit.upload({
            file: file.buffer,
            fileName: `payment_${Date.now()}_${file.originalname}`,
            folder
          });
          return result.url;
        } catch (error) {
          console.error("ImageKit upload error:", error);
          throw new Error(`Failed to upload ${file.originalname}`);
        }
      });
      screenshotUrls = await Promise.all(uploadPromises);

    } else if (screenshots && Array.isArray(screenshots)) {
      screenshotUrls = screenshots;
    }

    const draft = await DraftPayment.create({
      invoice: invoiceId || undefined,
      client: submittingClient,
      type: type || undefined,
      referenceNumber: referenceNumber || undefined,
      amount: Number(amount),
      paymentDate: new Date(paymentDate),
      currency: currency || undefined,
      notes: notes || undefined,
      screenshots: screenshotUrls,
      status: "pending",
      submittedByClient: req.clientId || undefined
    });

    // Notify client
    try {
      const to = { clientId: submittingClient };

      const clientDoc = await Client.findById(submittingClient)
        .select("email companyName primaryFirstName")
        .lean();

      if (clientDoc?.email) {
        to.email = clientDoc.email;
      }

      await sendNotification({
        to,
        channels: { email: Boolean(to.email), sms: false },
        templateKey: "draft_payment_submitted",
        templateVariables: {
          greeting: clientDoc?.companyName || "Ofis Square",
          memberName:
            clientDoc?.primaryFirstName ||
            clientDoc?.companyName ||
            "Member",
          invoiceNumber:
            invoice?.invoice_number ||
            invoice?.reference_number ||
            (invoiceId ? String(invoiceId) : "Untagged"),
          amount: Number(amount),
          paymentDate: paymentDate
            ? new Date(paymentDate).toISOString().slice(0, 10)
            : undefined,
          type: type || "",
          draftPaymentId: referenceNumber || "draft"
        },
        title: "Draft Payment Submitted",
        metadata: {
          category: "payments",
          tags: ["draft_payment_submitted"],
          route: `/draft-payments/${draft._id}`,
          deepLink: `ofis://draft-payments/${draft._id}`,
          routeParams: { id: String(draft._id) }
        },
        source: "system",
        type: "transactional"
      });

    } catch (notifyErr) {
      console.warn(
        "createDraftPayment: failed to send notification:",
        notifyErr?.message || notifyErr
      );
    }
    try {
      const financeRoles = await Role.find({ name: { $in: ['finance_junior', 'finance_senior'] } }).select('_id');
      if (financeRoles.length > 0) {
        const financeUsers = await User.find({ role: { $in: financeRoles.map(r => r._id) } }).select('email');
        const clientDoc = await Client.findById(submittingClient).select('companyName contactPerson').lean();

        let buildingName = 'Ofis Square';
        if (invoice?.building) { // Optimistic check if populated, else default
        }

        for (const user of financeUsers) {
          if (user.email) {
            await sendNotification({
              to: { email: user.email },
              channels: { email: true, sms: false },
              templateKey: 'finance_draft_payment_review_required',
              templateVariables: {
                greeting: 'Ofis Square',
                companyName: clientDoc?.companyName || 'Unknown Company',
                clientName: clientDoc?.contactPerson || 'Client',
                buildingName: buildingName,
                invoiceNumber: invoice?.invoice_number || invoice?.reference_number || (invoiceId ? String(invoiceId) : 'Untagged'),
                amount: Number(amount),
                paymentMode: type || 'N/A',
                transactionReference: referenceNumber || 'N/A',
                submittedDate: paymentDate ? new Date(paymentDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
                draftPaymentId: referenceNumber
              },
              title: 'Action Required – Draft Payment Submitted',
              metadata: {
                category: 'payments',
                tags: ['finance', 'draft-payment', 'approval-required'],
                route: `/payments/drafts/${draft._id}`,
                deepLink: `ofis://payments/drafts/${draft._id}`,
                routeParams: { id: String(draft._id) }
              },
              source: 'system',
              type: 'transactional'
            });
          }
        }
      }
    } catch (financeNotifyErr) {
      console.warn('createDraftPayment: failed to send finance_draft_payment_review_required notification:', financeNotifyErr?.message || financeNotifyErr);
    }

    return res.status(201).json({ success: true, data: draft });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error"
    });
  }
};


export const approveDraftPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { reviewNote, invoice: taggedInvoiceId } = req.body || {};

    // Role-based restriction: Only Finance Senior can approve draft payments
    const userRole = req.userRole?.roleName || "";
    if (userRole === "finance_junior") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only Finance Senior users can approve draft payments. Please contact your Finance Senior."
      });
    }

    const draft = await DraftPayment.findById(id).session(session);
    if (!draft) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Draft payment not found" });
    }

    if (!draft.invoice && taggedInvoiceId) {
      draft.invoice = taggedInvoiceId;
    }

    if (!draft.invoice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invoice is required to approve this draft payment. Please tag an invoice." });
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
        images: draft.screenshots || [], // Save draft screenshots as images
      },
    ], { session });

    // Update invoice totals
    const updatedInvoice = await applyInvoicePayment(draft.invoice, Number(draft.amount));

    // Update draft status
    draft.status = "approved";
    draft.reviewedBy = req.user?._id;
    draft.reviewNote = reviewNote || undefined;
    draft.reviewedAt = new Date();
    await draft.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Sync payment to Zoho Books (after transaction commit)
    try {
      if (updatedInvoice?.zoho_invoice_id && updatedInvoice.client?.zohoBooksContactId) {
        const zohoPaymentData = {
          customer_id: updatedInvoice.client?.zohoBooksContactId,
          payment_mode: getZohoPaymentMode(draft.type),
          amount: Number(draft.amount),
          date: draft.paymentDate ? new Date(draft.paymentDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          reference_number: draft.referenceNumber || undefined,
          description: draft.notes || `Payment for Invoice ${updatedInvoice.invoice_number || updatedInvoice.reference_number || ''}`,
          invoices: [{
            invoice_id: updatedInvoice.zoho_invoice_id,
            amount_applied: Number(draft.amount)
          }],
          account_id: updatedInvoice.building?.zohoChartsOfAccounts?.bank_account_id || undefined
        };

        console.log("🔍 Zoho sync prerequisites check:", {
          hasZohoInvoiceId: !!updatedInvoice.zoho_invoice_id,
          hasZohoBooksContactId: !!updatedInvoice.client?.zohoBooksContactId,
          invoiceId: updatedInvoice.zoho_invoice_id,
          contactId: updatedInvoice.client?.zohoBooksContactId,
          clientName: updatedInvoice.client?.companyName
        });

        console.log("🔄 Syncing payment to Zoho Books:", {
          invoiceId: updatedInvoice.zoho_invoice_id,
          amount: draft.amount,
          paymentMode: zohoPaymentData.payment_mode
        });

        const zohoResponse = await recordZohoPayment(updatedInvoice.zoho_invoice_id, zohoPaymentData);

        // Update payment record with Zoho Books payment ID
        if (zohoResponse?.payment?.payment_id) {
          await Payment.findByIdAndUpdate(payment[0]._id, {
            zoho_payment_id: zohoResponse.payment.payment_id,
            payment_number: zohoResponse.payment.payment_number,
            zoho_status: zohoResponse.payment.status,
            raw_zoho_response: zohoResponse.payment,
            source: "zoho_books"
          });
          console.log("✅ Payment synced to Zoho Books:", zohoResponse.payment.payment_id);
        }
      } else {
        console.log("⚠️ Zoho sync skipped:", {
          reason: !updatedInvoice?.zoho_invoice_id ? "No zoho_invoice_id" : "No zohoBooksContactId",
          invoiceId: updatedInvoice?._id,
          zohoInvoiceId: updatedInvoice?.zoho_invoice_id,
          clientId: updatedInvoice?.client?._id,
          zohoBooksContactId: updatedInvoice?.client?.zohoBooksContactId
        });
      }
    } catch (zohoError) {
      console.error("❌ Failed to sync payment to Zoho Books:", zohoError.message);
      // Don't fail the approval process if Zoho sync fails
    }

    // Notify client: draft payment approved
    try {
      const to = { clientId: draft.client };
      const clientDoc = await Client.findById(draft.client).select('email companyName contactPerson').lean();
      if (clientDoc?.email) to.email = clientDoc.email;

      const paymentDoc = Array.isArray(payment) ? payment[0] : payment;

      await sendNotification({
        to,
        channels: { email: Boolean(to.email), sms: false },
        templateKey: 'draft_payment_approved',
        templateVariables: {
          greeting: clientDoc?.companyName || 'Ofis Square',
          memberName: clientDoc?.contactPerson || clientDoc?.companyName || 'Member',
          invoiceNumber: updatedInvoice?.invoice_number || updatedInvoice?.reference_number || String(updatedInvoice?._id || draft.invoice),
          amount: Number(draft.amount),
          paymentDate: draft.paymentDate ? new Date(draft.paymentDate).toISOString().slice(0, 10) : undefined,
          type: draft.type || '',
          referenceNumber: draft.referenceNumber || '',
          paymentNumber: paymentDoc?.payment_number || ''
        },
        title: 'Draft Payment Approved',
        metadata: {
          category: 'payments',
          tags: ['draft_payment_approved'],
          route: `/payments/${paymentDoc?._id || ''}`,
          deepLink: `ofis://payments/${paymentDoc?._id || ''}`,
          routeParams: { id: String(paymentDoc?._id || '') }
        },
        source: 'system',
        type: 'transactional'
      });
    } catch (notifyErr) {
      console.warn('approveDraftPayment: failed to send draft_payment_approved notification:', notifyErr?.message || notifyErr);
    }

    // Send payment success notification (Generic template)
    try {
      const clientDoc = await Client.findById(draft.client).select('email companyName contactPerson').lean();
      const paymentDoc = Array.isArray(payment) ? payment[0] : payment;

      let serviceType = "Other Service";
      if (updatedInvoice?.category === 'meeting_room') {
        serviceType = "Meeting Room";
      } else if (updatedInvoice?.category === 'day_pass') {
        serviceType = "Day Pass";
      } else if (updatedInvoice?.category === 'cabin') {
        serviceType = "Cabin";
      }

      await sendNotification({
        to: {
          clientId: draft.client,
          email: clientDoc?.email
        },
        channels: { email: true, sms: true },
        templateKey: "service_payment_success",
        title: "Payment Successful",
        templateVariables: {
          greeting: "Ofis Square",
          serviceType,
          serviceName: updatedInvoice?.invoice_number || "Service",
          buildingName: "Ofis Square",
          serviceDate: draft.paymentDate ? new Date(draft.paymentDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          timeSlot: "N/A",
          amount: Number(draft.amount),
          paymentMode: draft.type || "Other",
          transactionId: draft.referenceNumber || "N/A",
          invoiceNumber: updatedInvoice?.invoice_number || updatedInvoice?.reference_number || "N/A",
          paymentDate: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
          paymentId: paymentDoc?._id
        },
        metadata: {
          category: "payments",
          tags: ["payment", "success", "booking"],
          route: `/payments/receipts/${paymentDoc?._id}`,
          deepLink: `ofis://payments/receipts/${paymentDoc?._id}`,
          routeParams: { id: String(paymentDoc?._id) }
        },
        source: "system",
        type: "transactional"
      });
    } catch (notifyErr) {
      console.warn('approveDraftPayment: failed to send service_payment_success notification:', notifyErr?.message || notifyErr);
    }

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

    // Role-based restriction: Only Finance Senior can reject draft payments
    const userRole = req.userRole?.roleName || "";
    if (userRole === "finance_junior") {
      return res.status(403).json({
        success: false,
        message: "Only Finance Senior users can reject draft payments. Please contact your Finance Senior."
      });
    }

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
      .populate("invoice", "invoice_number total amount_paid balance status due_date")
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
      .populate("invoice", "invoice_number total amount_paid balance status due_date")
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
