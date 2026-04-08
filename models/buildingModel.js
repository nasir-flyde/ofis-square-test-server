import mongoose from "mongoose";

const { Schema } = mongoose;

const BuildingSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: Schema.Types.ObjectId, ref: "City", required: true },
    state: { type: String },
    country: { type: String, default: "India" },
    pincode: { type: String },
    openingTime: { type: String, default: "09:00" },
    closingTime: { type: String, default: "19:00" },
    meetingCancellationGraceMinutes: { type: Number, min: 0, default: 5 },
    meetingPaymentPendingTimeoutMinutes: { type: Number, min: 0, default: 10 },
    meetingBookingCutoffMinutes: { type: Number, min: 0, default: 0 },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        index: '2dsphere'
      }
    },
    coordinates: {
      longitude: { type: Number },
      latitude: { type: Number }
    },
    businessMapLink: { type: String },
    coverPhotoUrl: { type: String },


    totalFloors: { type: Number },
    amenities: [{ type: Schema.Types.ObjectId, ref: "BuildingAmenity" }],
    perSeatPricing: {
      type: Number,
      min: 0,
      default: null
    },
    openSpacePricing: {
      type: Number,
      min: 0,
      default: null
    },
    dayPassDailyCapacity: {
      type: Number,
      min: 0,
      default: 0,
      index: true,
    },
    creditValue: {
      type: Number,
      min: 0,
      default: 500
    },
    communityDiscountMaxPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    printerCreditValue: {
      type: Number,
      min: 0,
      default: 1
    },
    draftInvoiceGeneration: {
      type: Boolean,
      default: false,
      index: true
    },
    draftInvoiceDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 25
    },
    draftInvoiceDueDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 7
    },
    estimateSendDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 26
    },
    invoiceSendDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 1
    },
    creditsRenewalDate: {
      type: Number,
      min: 1,
      max: 31,
      default: 1
    },
    dayPassMatrixPolicyId: { type: Schema.Types.ObjectId, ref: "AccessPolicy", default: null },
    lateFeePolicy: {
      enabled: { type: Boolean, default: false },
      gracePeriodDays: { type: Number, default: 0, min: 0 },
      customFormula: { type: String, default: undefined },
      variables: { type: Schema.Types.Mixed, default: undefined },
    },
    photos: [{
      category: { type: String, required: true, trim: true },
      images: [{
        url: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now }
      }]
    }],
    securityDepositThreshold: { type: Number, default: 20 },
    sdNoteSettings: {
      enabled: { type: Boolean, default: true },
      templateType: { type: String, enum: ['html', 'structured'], default: 'structured' },

      htmlTemplate: { type: String, default: undefined },

      logoUrl: { type: String, default: "https://ik.imagekit.io/8znjbhgdh/black%20logo.png" },
      darkLogoUrl: { type: String, default: "https://ik.imagekit.io/8znjbhgdh/white%20logo.png" },
      headerTitle: { type: String, default: "Security Deposit Notification" },
      companyName: { type: String, default: "OFIS SQUARE" },
      refundTimelineDays: { type: Number, default: 15 },
      paymentModesPlaceholder: { type: String, default: "[Bank Transfer / UPI / Cheque / Online Payment]" },

      introWelcomeText: { type: String, default: "Welcome to OFIS SQUARE. We’re delighted to have you join our workspace community." },
      depositRequirementText: { type: String, default: "As per the terms of your membership agreement, this is to inform you that a refundable security deposit is required prior to commencement of access to the workspace." },
      paymentInstructionText: { type: String, default: "Please proceed with the payment at your convenience to ensure uninterrupted access to the workspace. For any questions or clarifications, feel free to reach out to us." },
      closingSupportText: { type: String, default: "We look forward to supporting you in a productive and collaborative environment." },

      defaultPurposeText: { type: String, default: "To safeguard against any damage to property, loss of assets, unpaid dues, or breach of membership terms." },
      defaultRefundabilityText: { type: String, default: "The security deposit is fully refundable upon termination of the membership, subject to adjustment of any outstanding dues or damages, as per the agreement." },

      footerDefaults: {
        designation: { type: String, default: "Team" },
        phone: { type: String, default: "" },
        email: { type: String, default: "" },
      },

      dynamicDefaults: [
        {
          label: { type: String },
          value: { type: String },
        }
      ],

      templateVersion: { type: Number, default: 1 },
    },

    wifiAccess: {
      enterpriseLevel: {
        enabled: { type: Boolean, default: false },
        wifiName: { type: String, default: undefined },
        nasRefs: [{ type: Schema.Types.ObjectId, ref: "BhaifiNas", index: true }],
        defaultProfile: { type: String, default: undefined },
        defaultValidityDays: { type: Number, default: undefined },
      },
      daypass: {
        enabled: { type: Boolean, default: false },
        nasRefs: [{ type: Schema.Types.ObjectId, ref: "BhaifiNas", index: true }],
      },
    },

    bankDetails: {
      accountHolderName: { type: String, default: 'OFIS SPACES PRIVATE LIMITED' },
      bankName: { type: String, default: 'HDFC Bank Ltd.' },
      branchName: { type: String, default: 'MG Road, Gurgaon' },
      accountType: { type: String, default: 'Current Account' },
      accountNumber: { type: String, default: '5020 1234 5678' },
      ifscCode: { type: String, default: 'HDFC0009876' }
    },

    zoho_books_location_id: { type: String, trim: true, default: null },
    place_of_supply: { type: String, trim: true, default: null },
    zohoChartsOfAccounts: {
      bank_account_id: { type: String, default: null },
      bank_account_name: { type: String, default: null },
      security_deposit_account_id: { type: String },
      zoho_sd_receivable_id: { type: String, index: true },
      zoho_sd_payable_id: { type: String, index: true },
      zoho_sd_clearing_id: { type: String },
    },
    zoho_monthly_payment_item_id: { type: String, default: "" }, // Zoho Books Item ID for monthly rent
    dayPassItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    meetingItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    lateFeeItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    zoho_tax_id: { type: String, default: "" }, // Unified Zoho Tax ID/Group ID for this building
    status: { type: String, enum: ["draft", "active", "inactive"], default: "draft", index: true },
  },
  {
    timestamps: true,
    collection: "buildings",
  }
);

export default mongoose.model("Building", BuildingSchema);
