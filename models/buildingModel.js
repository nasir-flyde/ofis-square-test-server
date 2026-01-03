import mongoose from "mongoose";

const { Schema } = mongoose;

const BuildingSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    country: { type: String, default: "India" },
    pincode: { type: String },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        index: '2dsphere'
      }
    },
    coordinates: {
      longitude: { type: Number },
      latitude: { type: Number }
    },
    businessMapLink: { type: String },

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
    creditValue: {
      type: Number,
      min: 0,
      default: 500
    },
    // Maximum discount percentage allowed for community bookings at building level
    communityDiscountMaxPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
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
    // Late fee policy (per-building defaults)
    lateFeePolicy: {
      enabled: { type: Boolean, default: false },
      gracePeriodDays: { type: Number, default: 0, min: 0 },
      customFormula: { type: String, default: undefined },
      variables: { type: Schema.Types.Mixed, default: undefined },
    },
    photos: [{
      category: { type: String, required: true, trim: true },
      imageUrl: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now }
    }],

    // Security Deposit Note template and defaults (per-building configurable)
    sdNoteSettings: {
      enabled: { type: Boolean, default: true },
      // Choose whether to use a full HTML template or structured defaults
      templateType: { type: String, enum: ['html', 'structured'], default: 'structured' },

      // Optional complete HTML override. If provided and templateType==='html', this will be used.
      // You can use placeholders like {{memberName}}, {{amountDeposited}}, {{agreedAmount}}, {{refundTimelineDays}},
      // {{paymentMode}}, {{dueDate}}, {{paidDate}}, {{companyName}}, {{logoUrl}}, {{signerName}}, {{signerDesignation}}, {{signerPhone}}, {{signerEmail}}
      htmlTemplate: { type: String, default: undefined },

      // Structured defaults (used when templateType==='structured')
      logoUrl: { type: String, default: "https://ik.imagekit.io/8znjbhgdh/black%20logo.png" },
      darkLogoUrl: { type: String, default: "https://ik.imagekit.io/8znjbhgdh/white%20logo.png" },
      headerTitle: { type: String, default: "Security Deposit Notification" },
      companyName: { type: String, default: "OFIS SQUARE" },
      refundTimelineDays: { type: Number, default: 15 },
      paymentModesPlaceholder: { type: String, default: "[Bank Transfer / UPI / Cheque / Online Payment]" },

      // Newly added default text blocks for SD Note body
      introWelcomeText: { type: String, default: "Welcome to OFIS SQUARE. We’re delighted to have you join our workspace community." },
      depositRequirementText: { type: String, default: "As per the terms of your membership agreement, this is to inform you that a refundable security deposit is required prior to commencement of access to the workspace." },
      paymentInstructionText: { type: String, default: "Please proceed with the payment at your convenience to ensure uninterrupted access to the workspace. For any questions or clarifications, feel free to reach out to us." },
      closingSupportText: { type: String, default: "We look forward to supporting you in a productive and collaborative environment." },

      // Static text blocks used in the note body
      defaultPurposeText: { type: String, default: "To safeguard against any damage to property, loss of assets, unpaid dues, or breach of membership terms." },
      defaultRefundabilityText: { type: String, default: "The security deposit is fully refundable upon termination of the membership, subject to adjustment of any outstanding dues or damages, as per the agreement." },

      // Footer defaults (actual signer will come from logged-in user, these are fallbacks)
      footerDefaults: {
        designation: { type: String, default: "Team" },
        phone: { type: String, default: "" },
        email: { type: String, default: "" },
      },

      // Optional default extra fields rendered under an "Additional Details" section
      dynamicDefaults: [
        {
          label: { type: String },
          value: { type: String },
        }
      ],

      // Simple versioning in case template structure changes
      templateVersion: { type: Number, default: 1 },
    },

    // TDS Settings removed (was previously under tdsSettings)
    // All TDS-related configuration has been deprecated and removed from the system.

    status: { type: String, enum: ["draft", "active", "inactive"], default: "draft", index: true },
  },
  {
    timestamps: true,
    collection: "buildings",
  }
);

export default mongoose.model("Building", BuildingSchema);
