import mongoose from "mongoose";

// New DocumentEntity-backed KYC items (normalized)
const kycDocumentItemSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentEntity", default: null },
    fieldName: { type: String, trim: true }, // e.g., panCard, addressProof
    fileName: { type: String, trim: true },
    url: { type: String, trim: true },
    number: { type: String, trim: true }, // e.g., PAN number, GSTIN, CIN, etc.
    approved: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    // Basic company info
    companyName: { type: String, required: false, trim: true },
    legalName: { type: String, trim: true, default: undefined },
    contactPerson: { type: String, trim: true },
    // Structured primary contact details (for Zoho mapping)
    primarySalutation: { type: String, trim: true, default: undefined },
    primaryFirstName: { type: String, trim: true, default: undefined },
    primaryLastName: { type: String, trim: true, default: undefined },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true, default: undefined },
    companyAddress: { type: String, trim: true },
    industry: { type: String, trim: true, default: undefined },

    // Authority Signee settings (local only; will be sent as contact person to Zoho if different)
    isPrimaryContactauthoritySignee: { type: Boolean, default: true },
    authoritySignee: {
      salutation: { type: String, trim: true, default: undefined },
      firstName: { type: String, trim: true, default: undefined },
      lastName: { type: String, trim: true, default: undefined },
      email: { type: String, trim: true, lowercase: true, default: undefined },
      phone: { type: String, trim: true, default: undefined },
      designation: { type: String, trim: true, default: undefined },
      department: { type: String, trim: true, default: undefined },
    },

    // Commercial details
    contactType: { type: String, enum: ["customer", "vendor", "both"], default: "customer" },
    customerSubType: { type: String, enum: ["business", "individual"], default: "business" },
    creditLimit: { type: Number, default: undefined },
    contactNumber: { type: String, trim: true, default: undefined },
    isPortalEnabled: { type: Boolean, default: false },
    paymentTerms: { type: Number, default: undefined },
    paymentTermsLabel: { type: String, trim: true, default: undefined },
    notes: { type: String, trim: true, default: undefined },

    // Addresses
    billingAddress: {
      attention: { type: String, trim: true, default: undefined },
      address: { type: String, trim: true, default: undefined },
      street2: { type: String, trim: true, default: undefined },
      state_code: { type: String, trim: true, default: undefined },
      city: { type: String, trim: true, default: undefined },
      state: { type: String, trim: true, default: undefined },
      zip: { type: String, trim: true, default: undefined },
      country: { type: String, trim: true, default: undefined },
      fax: { type: String, trim: true, default: undefined },
      phone: { type: String, trim: true, default: undefined },
    },
    shippingAddress: {
      attention: { type: String, trim: true, default: undefined },
      address: { type: String, trim: true, default: undefined },
      street2: { type: String, trim: true, default: undefined },
      state_code: { type: String, trim: true, default: undefined },
      city: { type: String, trim: true, default: undefined },
      state: { type: String, trim: true, default: undefined },
      zip: { type: String, trim: true, default: undefined },
      country: { type: String, trim: true, default: undefined },
      fax: { type: String, trim: true, default: undefined },
      phone: { type: String, trim: true, default: undefined },
    },

    contactPersons: [
      {
        salutation: { type: String, trim: true, default: undefined },
        first_name: { type: String, trim: true, default: undefined },
        last_name: { type: String, trim: true, default: undefined },
        email: { type: String, trim: true, lowercase: true, default: undefined },
        phone: { type: String, trim: true, default: undefined },
        mobile: { type: String, trim: true, default: undefined },
        designation: { type: String, trim: true, default: undefined },
        department: { type: String, trim: true, default: undefined },
        is_primary_contact: { type: Boolean, default: false },
        communication_preference: {
          is_sms_enabled: { type: Boolean, default: false },
          is_whatsapp_enabled: { type: Boolean, default: false },
        },
        enable_portal: { type: Boolean, default: false },
      },
    ],

    gstNumber: { type: String, trim: true, default: undefined },
    gstNo: { type: String, trim: true, default: undefined },
    gstTreatment: { type: String, trim: true, default: undefined },
    isTaxable: { type: Boolean, default: true },
    taxRegNo: { type: String, trim: true, default: undefined },
    // Optional: store multiple GST registrations locally to mirror Zoho tax_info_list
    taxInfoList: {
      type: [
        new mongoose.Schema(
          {
            tax_info_id: { type: String, trim: true },
            tax_registration_no: { type: String, trim: true },
            place_of_supply: { type: String, trim: true },
            is_primary: { type: Boolean, default: false },
            legal_name: { type: String, trim: true },
            trader_name: { type: String, trim: true },
          },
          { _id: false }
        )
      ],
      default: []
    },
    zohoBooksContactId: { type: String, trim: true, index: true },
    pricebookId: { type: String, trim: true, default: undefined },
    currencyId: { type: String, trim: true, default: undefined },

    // Extra credits (excess payments not yet applied to any invoice)
    extra_credits: { type: Number, default: 0 },

    // Security deposit details
    securityDeposit: { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDeposit", index: true, default: null },
    isSecurityPaid: { type: Boolean, default: false },

    // Parking details (synced from contract on final approval)
    parkingSpaces: {
      noOf2WheelerParking: { type: Number, default: 0 },
      noOf4WheelerParking: { type: Number, default: 0 },
    },

    // Status & ownership
    companyDetailsComplete: { type: Boolean, default: false },
    kycStatus: {
      type: String,
      enum: ["none", "pending", "verified", "rejected"],
      default: "none",
    },
    membershipStatus: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "active",
      index: true
    },
    // Normalized KYC documents using DocumentEntity references
    kycDocumentItems: { type: [kycDocumentItemSchema], default: [] },
    kycRejectionReason: { type: String, default: undefined },
    isClientApproved: { type: Boolean, default: false, index: true },
    ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: null },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true, default: null },

    // Late fee policy override (client-specific)
    lateFeePolicy: {
      enabled: { type: Boolean, default: undefined },
      reason: { type: String, default: undefined },
      gracePeriodDays: { type: Number, default: undefined, min: 0 },
      customFormula: { type: String, default: undefined },
      variables: { type: mongoose.Schema.Types.Mixed, default: undefined },
    },
    isMigrated: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: "clients",
  }
);

export default mongoose.model("Client", clientSchema);
