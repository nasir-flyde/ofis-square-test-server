import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
    paymentGatewayRef: { type: String, trim: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: "payments",
  }
);

export default mongoose.model("Payment", paymentSchema);
