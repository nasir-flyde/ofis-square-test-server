import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },

    // Payment method/type
    type: {
      type: String,
      enum: [
        "Bank Transfer",
        "Cash",
        "UPI",
        "Card",
        "Cheque",
        "Online Gateway",
      ],
      default: "Bank Transfer",
      index: true,
    },

    paymentGatewayRef: { type: String, trim: true },
    referenceNumber: { type: String, trim: true }, // e.g., UTR, cheque no, transaction id
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },

    currency: { type: String, default: "INR" },
    // Bank transfer specific details
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: "payments",
  }
);

export default mongoose.model("Payment", paymentSchema);
