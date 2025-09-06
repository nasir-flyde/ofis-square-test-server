import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    companyName: { type: String, required:false, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    companyAddress: { type: String, trim: true },
    companyDetailsComplete: { type: Boolean, default: false },
    // Zoho Books integration
    zohoBooksContactId: { type: String, trim: true, index: true },
    kycStatus: {
      type: String,
      enum: ["none", "pending", "verified", "rejected"],
      default: "none",
    },
    kycDocuments: { type: mongoose.Schema.Types.Mixed, default: null },
    kycRejectionReason: { type: String, default: undefined },
  },
  {
    timestamps: true,
    collection: "clients",
  }
);

export default mongoose.model("Client", clientSchema);
