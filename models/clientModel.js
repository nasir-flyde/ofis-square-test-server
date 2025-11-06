import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    // Basic company info
    companyName: { type: String, required:false, trim: true },
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
    zohoBooksContactId: { type: String, trim: true, index: true },
    pricebookId: { type: String, trim: true, default: undefined },
    currencyId: { type: String, trim: true, default: undefined },

    // Security deposit details
    securityDeposit: {
      type: { type: String, trim: true, default: undefined },
      amount: { type: Number, default: 0, min: 0 },
      notes: { type: String, trim: true, default: undefined },
    },
    isSecurityPaid: { type: Boolean, default: false },

    // Status & ownership
    companyDetailsComplete: { type: Boolean, default: false },
    kycStatus: {
      type: String,
      enum: ["none", "pending", "verified", "rejected"],
      default: "none",
    },
    kycDocuments: { type: mongoose.Schema.Types.Mixed, default: null },
    kycRejectionReason: { type: String, default: undefined },
    isClientApproved: { type: Boolean, default: false, index: true },
    ownerUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, default: null },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true, default: null },
  },
  {
    timestamps: true,
    collection: "clients",
  }
);

export default mongoose.model("Client", clientSchema);
