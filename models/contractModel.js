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
    securityDeposit: { type: Number },
    terms: { type: String, trim: true },
    status: {
      type: String,
      enum: ["draft", "pending_signature", "active"],
      default: "draft",
      index: true,
    },
    fileUrl: { type: String, trim: true, default: "placeholder" },
    zohoSignRequestId: { type: String, trim: true },
    sentForSignatureAt: { type: Date },
    signedAt: { type: Date },
    declinedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "contracts",
  }
);

export default mongoose.model("Contract", contractSchema);
