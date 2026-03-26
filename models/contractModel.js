import mongoose from "mongoose";
import DocumentEntity from "./documentEntityModel.js";

// Normalized KYC Document item referencing DocumentEntity
const kycDocumentItemSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentEntity", default: null },
    fieldName: { type: String, trim: true },
    fileName: { type: String, trim: true },
    url: { type: String, trim: true },
    number: { type: String, trim: true },
    approved: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Optional billing period (can differ from contract tenure)
    billingStartDate: { type: Date, default: null },
    billingEndDate: { type: Date, default: null },
    commencementDate: { type: Date },
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
    // Separate printer credits allocation for this contract
    printerCredits: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Printer credits must be an integer"
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
    securityDeposit: { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDeposit", index: true, default: null },
    securityDepositPaidAt: { type: Date },
    securityDepositPaidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Legal and administrative fields
    legalExpenses: { type: Number, default: 1200, min: 0 },
    allocationSeatsNumber: { type: Number, default: 0 },
    // Parking details
    parkingSpaces: {
      noOf2WheelerParking: { type: Number, default: 0 },
      noOf4WheelerParking: { type: Number, default: 0 }
    },
    // Parking fees (per slot)
    parkingFees: {
      twoWheeler: { type: Number, default: 1500, min: 0 },
      fourWheeler: { type: Number, default: 5000, min: 0 }
    },
    // Contract duration details
    durationMonths: { type: Number, default: 12 },
    lockInPeriodMonths: { type: Number, default: 0 },
    noticePeriodDays: { type: Number, default: 30 },
    // Escalation details
    escalationRatePercentage: { type: Number, default: 0 },
    escalation: {
      ratePercent: { type: Number, default: 0 },
      frequencyMonths: { type: Number, default: 12 }
    },
    // Renewal details
    renewal: {
      isAutoRenewal: { type: Boolean, default: false },
      renewalTermMonths: { type: Number, default: 12 }
    },
    // Fully serviced business hours
    fullyServicedBusinessHours: {
      startTime: { type: String, default: "09:00" },
      endTime: { type: String, default: "18:00" },
      days: { type: [String], default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] }
    },
    // Additional charges
    cleaningAndRestorationFees: { type: Number, default: 2000, min: 0 },
    // Freebies
    freebies: [{ type: String, trim: true }],
    // Pay as you go services
    payAsYouGo: {
      acCharges: [{ type: Number }],
      additions: [{ type: String, trim: true }]
    },
    terms: { type: String, trim: true },
    termsandconditions: [{
      denotations: {
        heading: { type: String, default: "Denotations" },
        body: [{ type: String }]
      },
      scope: {
        heading: { type: String, default: "Scope" },
        body: [{ type: String }]
      },
      rightsGrantedToClient: {
        heading: { type: String, default: "Rights granted to the Client" },
        body: [{ type: String }]
      },
      payments: {
        heading: { type: String, default: "Payments of Charges" },
        body: [{ type: String }]
      },
      consequencesOfNonPayment: {
        heading: { type: String, default: "Consequences of Non-Payment" },
        body: [{ type: String }]
      },
      obligationsOfClient: {
        heading: { type: String, default: "Obligations of the Client" },
        body: [{ type: String }]
      },
      obligationsOfOfisSquare: {
        heading: { type: String, default: "Rights / Obligations of Ofis Square" },
        body: [{ type: String }]
      },
      termination: {
        heading: { type: String, default: "Termination" },
        body: [{ type: String }]
      },
      consequencesOfTermination: {
        heading: { type: String, default: "Consequences of Termination" },
        body: [{ type: String }]
      },
      renewal: {
        heading: { type: String, default: "Renewal" },
        body: [{ type: String }]
      },
      miscellaneous: {
        heading: { type: String, default: "Miscellaneous" },
        body: [{ type: String }]
      },
      parking: {
        heading: { type: String, default: "Parking" },
        body: [{ type: String }]
      },
      disputeResolution: {
        heading: { type: String, default: "Dispute Resolution" },
        body: [{ type: String }]
      },
      governingLaw: {
        heading: { type: String, default: "Governing Law" },
        body: [{ type: String }]
      },
      electronicSignature: {
        heading: { type: String, default: "Electronic Signature Acknowledgement And Consent" },
        body: [{ type: String }]
      }
    }],
    // Terms and conditions acceptance
    termsAndConditionAcceptance: {
      ofisSquareAcceptance: {
        name: { type: String, trim: true },
        designation: { type: String, trim: true },
        dateOfBoardResolution: { type: Date },
        companyStamp: { type: String, trim: true },
        signedAt: { type: Date },
        signatureUrl: { type: String, trim: true }
      },
      clientAcceptance: {
        name: { type: String, trim: true },
        designation: { type: String, trim: true },
        dateOfBoardResolution: { type: Date },
        companyStamp: { type: String, trim: true },
        signedAt: { type: Date },
        signatureUrl: { type: String, trim: true }
      }
    },
    status: {
      type: String,
      enum: [
        "pushed",
        "draft",
        "submitted_to_legal",
        "legal_reviewed",
        "pending_admin_approval",
        "admin_approved",
        "admin_rejected",
        "sales_senior_rejected",
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
    // Workflow mode selection (automated vs custom)
    workflowMode: {
      type: String,
      enum: ["automated", "custom"],
      default: "custom",
      index: true,
    },
    workflowModeMeta: {
      selectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      selectedAt: { type: Date },
      reason: { type: String, trim: true },
      // Lock by default to prevent accidental flips; allow admin override via force
      locked: { type: Boolean, default: false },
    },
    // Approval workflow fields
    requiresApproval: {
      type: Boolean,
      default: true,
    },
    // New approval flag system
    iskycuploaded: {
      type: Boolean,
      default: false,
    },
    iskycapproved: {
      type: Boolean,
      default: false,
    },
    adminapproved: {
      type: Boolean,
      default: false,
    },
    legalteamapproved: {
      type: Boolean,
      default: false,
    },
    clientapproved: {
      type: Boolean,
      default: false,
    },
    financeapproved: {
      type: Boolean,
      default: false,
    },
    securitydeposited: {
      type: Boolean,
      default: false,
    },
    iscontractsentforsignature: {
      type: Boolean,
      default: false,
    },
    iscontractstamppaperupload: {
      type: Boolean,
      default: false,
    },
    isclientsigned: {
      type: Boolean,
      default: false,
    },
    isfinalapproval: {
      type: Boolean,
      default: false,
    },
    // Normalized KYC documents only (legacy kycDocuments removed)
    kycDocumentItems: { type: [kycDocumentItemSchema], default: [] },
    kycApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    kycApprovedAt: { type: Date },
    adminApprovalReason: { type: String, trim: true },
    legalApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    legalApprovedAt: { type: Date },
    legalApprovalReason: { type: String, trim: true },
    // Sales Senior review/approval fields (custom flow)
    salesSeniorApproved: { type: Boolean, default: false },
    salesSeniorApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    salesSeniorApprovedAt: { type: Date },
    salesSeniorApprovalNotes: { type: String, trim: true },
    // Legal upload metadata (using existing fileUrl for document)
    legalUploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    legalUploadedAt: { type: Date },
    legalUploadNotes: { type: String, trim: true },
    financeApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    financeApprovedAt: { type: Date },
    financeApprovalReason: { type: String, trim: true },
    finalApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    finalApprovedAt: { type: Date },
    finalApprovalReason: { type: String, trim: true },
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
    // Tax profile (selected for this contract)
    gst_no: { type: String, trim: true },
    gst_treatment: { type: String, trim: true },
    place_of_supply: { type: String, trim: true },
    // Client approval/feedback
    clientApprovedAt: { type: Date },
    clientFeedback: { type: String, trim: true },
    clientFeedbackAt: { type: Date },
    clientFeedbackHistory: [
      {
        text: { type: String, trim: true },
        submittedAt: { type: Date, default: Date.now },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      }
    ],
    clientFeedbackAttachments: [{
      fileName: { type: String, trim: true },
      fileUrl: { type: String, trim: true },
      uploadedAt: { type: Date, default: Date.now }
    }],
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
    // Version control (removed)
    lastActionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lastActionAt: { type: Date },
    // Comments/notes
    comments: [
      {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId()
        },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        at: { type: Date, default: Date.now },
        type: {
          type: String,
          enum: ["review", "internal", "client", "legal_only"],
          default: "internal",
        },
        message: { type: String, trim: true },
        mentionedUsers: [{
          type: mongoose.Schema.Types.ObjectId,
          ref: "User"
        }],
        // Thread/reply support
        parentCommentId: {
          type: mongoose.Schema.Types.ObjectId,
          default: null,
          ref: "comments"
        },
        // Section-specific comment fields
        sectionType: {
          type: String,
          enum: ["general", "terms_section"],
          default: "general"
        },
        termsSection: {
          type: String,
          enum: [
            "denotations", "scope", "rightsGrantedToClient", "payments",
            "consequencesOfNonPayment", "obligationsOfClient", "obligationsOfOfisSquare",
            "termination", "consequencesOfTermination", "renewal", "miscellaneous",
            "parking", "disputeResolution", "governingLaw", "electronicSignature"
          ]
        },
        paragraphIndex: { type: Number }, // For commenting on specific paragraphs within a section
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
    addOns: [
      {
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: "AddOn" },
        description: { type: String, required: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
        quantity: { type: Number, default: 1, min: 1 },
        startDate: { type: Date },
        endDate: { type: Date },
        billingCycle: { type: String, enum: ["monthly", "one-time"], default: "monthly" },
        status: { type: String, enum: ["active", "inactive", "billed"], default: "active" },
        zoho_item_id: { type: String, default: "" },
        addedAt: { type: Date, default: Date.now },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    // Sales metadata fields
    entityType: {
      type: String,
      enum: ["LLP", "Company", "Partnership", "Proprietorship", "Individual", "Other"],
      default: null,
    },
    type: {
      type: String,
      enum: ["New", "Shift", "Expansion"],
      default: null,
    },
    billableSeats: { type: Number, default: null, min: 0 },
    leadOwnerName: { type: String, trim: true, default: null },
    broker: {
      isDirect: { type: Boolean, default: true },
      brokerName: { type: String, trim: true, default: null },
    },
    commission: {
      percentage: { type: Number, default: null, min: 0, max: 100 },
      paymentType: { type: String, enum: ["one_time", "monthly"], default: null },
      periodMonths: { type: Number, default: null, min: 0 },
    },
  },
  {
    timestamps: true,
    collection: "contracts",
  }
);

// Middleware to automatically update iskycapproved using normalized KYC items
contractSchema.pre('save', async function (next) {
  try {
    const requiredDocs = await DocumentEntity.find({
      isActive: true,
      required: true,
    }).select("_id fieldName").lean();

    if (!Array.isArray(requiredDocs) || requiredDocs.length === 0) {
      // No required docs configured; do not change iskycapproved here.
      // This allows explicit approval via controller to set it to true when desired.
      return next();
    }

    const items = Array.isArray(this.kycDocumentItems) ? this.kycDocumentItems : [];
    const allApproved = requiredDocs.every((d) => {
      return items.some((it) => {
        const matchesById = it.document && String(it.document) === String(d._id);
        const matchesByField = it.fieldName && it.fieldName === d.fieldName;
        return (matchesById || matchesByField) && it.url && it.approved === true;
      });
    });
    this.iskycapproved = allApproved;
    next();
  } catch (e) {
    console.warn("Contract pre-save KYC approval check failed:", e?.message);
    next();
  }
});

export default mongoose.model("Contract", contractSchema);
