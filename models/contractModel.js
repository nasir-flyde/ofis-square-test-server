import mongoose from "mongoose";

const contractSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    commencementDate: { type: Date },
    allocationDate: { type: Date },
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
    // Legal and administrative fields
    legalExpenses: { type: Number, default: 0, min: 0 },
    allocationSeatsNumber: { type: Number, default: 0 },
    // Parking details
    parkingSpaces: {
      noOf2WheelerParking: { type: Number, default: 0 },
      noOf4WheelerParking: { type: Number, default: 0 }
    },
    // Contract duration details
    durationMonths: { type: Number, default: 12 },
    lockInPeriodMonths: { type: Number, default: 0 },
    noticePeriodDays: { type: Number, default: 30 },
    // Escalation details
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
    cleaningAndRestorationFees: { type: Number, default: 0, min: 0 },
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
    // Additional fields for approval workflow
    kycDocuments: {
      addressProof: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      boardResolutionOrLetterOfAuthority: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      photoIdAndAddressProofOfSignatory: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      certificateOfIncorporation: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      businessLicenseGST: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      panCard: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      tanNo: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      moa: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      },
      aoa: {
        fileName: { type: String, trim: true },
        fileUrl: { type: String, trim: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now }
      }
    },
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
    // Client approval/feedback
    clientApprovedAt: { type: Date },
    clientFeedback: { type: String, trim: true },
    clientFeedbackAt: { type: Date },
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
  },
  {
    timestamps: true,
    collection: "contracts",
  }
);

// Middleware to automatically update iskycapproved when all KYC documents are approved
contractSchema.pre('save', function(next) {
  const allDocumentsApproved =
    this.kycDocuments.addressProof?.approved &&
    this.kycDocuments.boardResolutionOrLetterOfAuthority?.approved &&
    this.kycDocuments.photoIdAndAddressProofOfSignatory?.approved &&
    this.kycDocuments.certificateOfIncorporation?.approved &&
    this.kycDocuments.businessLicenseGST?.approved &&
    this.kycDocuments.panCard?.approved &&
    this.kycDocuments.tanNo?.approved &&
    this.kycDocuments.moa?.approved &&
    this.kycDocuments.aoa?.approved;

  if (allDocumentsApproved) {
    this.iskycapproved = true;
  } else {
    this.iskycapproved = false;
  }

  next();
});

export default mongoose.model("Contract", contractSchema);

