import mongoose from "mongoose";

const contractSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1 },
    monthlyRent: {
      type: Number,
      required: true,
      min: 0
    },
    initialCredits: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Initial credits must be an integer"
      }
    },
    creditValueAtSignup: {
      type: Number,
      default: null,
      min: 0
    },
    // Credit system fields
    credit_enabled: {
      type: Boolean,
      default: true
    },
    allocated_credits: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Allocated credits must be an integer"
      }
    },
    credit_value: {
      type: Number,
      default: 500, // ₹500 per credit
      min: 0
    },
    credit_terms_days: {
      type: Number,
      default: 30, // Payment terms for credit invoices
      min: 0
    },
    // Security deposit details
    securityDeposit: {
      type: { type: String, trim: true, default: undefined },
      amount: { type: Number, default: 0, min: 0 },
      notes: { type: String, trim: true, default: undefined },
    },
    securityDepositPaidAt: { type: Date },
    securityDepositPaidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    terms: { type: String, trim: true },
    status: {
      type: String,
      enum: [
        "draft",
        "submitted_to_legal",
        "legal_reviewed",
        "pending_admin_approval",
        "admin_approved",
        "admin_rejected",
        "sent_to_client",
        "client_approved",
        "client_feedback_pending",
        "stamp_paper_ready",
        "sent_for_signature",
        "signed",
        "active",
        "cancelled"
      ],
      default: "draft",
      index: true,
    },
    // Approval workflow fields
    requiresApproval: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    // Sales submission to Legal
    submittedToLegalBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    submittedToLegalAt: { type: Date },
    // Legal submission to Admin
    submittedToAdminBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    submittedToAdminAt: { type: Date },
    // Admin approval/rejection
    adminApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    adminApprovedAt: { type: Date },
    adminRejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    adminRejectedAt: { type: Date },
    adminRejectionReason: { type: String, trim: true },
    approvalType: {
      type: String,
      enum: ["full", "partial"],
    },
    approvalConditions: { type: String, trim: true },
    // Sent to client
    sentToClientBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sentToClientAt: { type: Date },
    clientEmail: { type: String, trim: true },
    // Client approval/feedback
    clientApprovedAt: { type: Date },
    clientFeedback: { type: String, trim: true },
    clientFeedbackAt: { type: Date },
    // Stamp paper
    stampPaperGeneratedAt: { type: Date },
    stampPaperUrl: { type: String, trim: true },
    // E-signature
    signatureProvider: {
      type: String,
      enum: ["zoho_sign", "docusign", "manual"],
      default: "zoho_sign",
    },
    signatureEnvelopeId: { type: String, trim: true },
    sentForSignatureAt: { type: Date },
    signedAt: { type: Date },
    signedBy: { type: String, trim: true },
    declinedAt: { type: Date },
    // Version control
    version: {
      type: Number,
      default: 1,
    },
    lastActionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lastActionAt: { type: Date },
    // Comments/notes
    comments: [
      {
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        at: { type: Date, default: Date.now },
        type: {
          type: String,
          enum: ["review", "internal", "client"],
          default: "internal",
        },
        message: { type: String, trim: true },
      },
    ],
    // Legacy fields for backward compatibility
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    submittedAt: { type: Date },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: { type: Date },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    fileUrl: { type: String, trim: true, default: "placeholder" },
    zohoSignRequestId: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: "contracts",
  }
);

export default mongoose.model("Contract", contractSchema);

