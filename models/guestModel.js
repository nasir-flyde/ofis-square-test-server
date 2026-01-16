import mongoose from "mongoose";

const guestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    companyName: { type: String, trim: true },
    notes: { type: String, trim: true },
    // KYC fields for guest verification
    kycDocuments: {
      files: [{
        type: String,
        trim: true,
      }],
    },
    kycStatus: {
      type: String,
      enum: ['not_submitted', 'pending', 'approved', 'rejected'],
      default: 'not_submitted',
    },
    // Zoho Books mapping for ondemand users
    zohoBooksContactId: { type: String, trim: true, index: true, default: null },
  },
  {
    timestamps: true,
    collection: "guests",
  }
);

const Guest = mongoose.model("Guest", guestSchema);
export default Guest;
