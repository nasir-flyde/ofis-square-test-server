import mongoose from "mongoose";

const securityDepositPaymentSchema = new mongoose.Schema(
  {
    deposit: { type: mongoose.Schema.Types.ObjectId, ref: "SecurityDeposit", required: true, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },
    
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true, default: Date.now },
    
    type: {
      type: String,
      enum: [
        "Bank Transfer",
        "BankTransfer",
        "Cash",
        "UPI",
        "Card",
        "Cheque",
        "NEFT",
        "RTGS",
        "IMPS",
        "Other"
      ],
      default: "Bank Transfer"
    },
    
    referenceNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
    images: [{ type: String }],
    
    zoho_journal_id: { type: String, index: true },
    zoho_journal_number: { type: String },
    
    source: {
      type: String,
      enum: ["manual", "migration", "webhook"],
      default: "manual"
    }
  },
  {
    timestamps: true,
    collection: "security_deposit_payments"
  }
);

export default mongoose.model("SecurityDepositPayment", securityDepositPaymentSchema);
