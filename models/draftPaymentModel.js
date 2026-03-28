import mongoose from "mongoose";

const draftPaymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: false, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    type: {
      type: String,
      enum: ["Bank Transfer", "Cash", "UPI", "Card", "Cheque", "Online Gateway"],
      default: "Bank Transfer",
      index: true,
    },
    referenceNumber: { type: String, trim: true }, 
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
    currency: { type: String, default: "INR" },
    notes: { type: String, trim: true },
    screenshots: [{ type: String }], // Array of image URLs/paths
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    submittedByClient: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, 
    reviewNote: { type: String, trim: true },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "draft_payments",
  }
);

export default mongoose.model("DraftPayment", draftPaymentSchema);
