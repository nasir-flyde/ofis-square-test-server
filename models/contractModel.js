import mongoose from "mongoose";

const contractSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
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
