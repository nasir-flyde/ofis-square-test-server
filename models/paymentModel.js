import mongoose from "mongoose";

const paymentInvoiceSchema = new mongoose.Schema({
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true },
  amount_applied: { type: Number, required: true },
  zoho_invoice_id: { type: String },
  // Withholding on this invoice allocation (e.g., TDS deducted by customer)
  tax_deducted: { type: Boolean, default: false },
  tax_amount_withheld: { type: Number, default: 0 },
});

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest", index: true },

    invoices: [paymentInvoiceSchema],

    type: {
      type: String,
      enum: [
        "Bank Transfer",
        "BankTransfer",
        "Cash",
        "UPI",
        "Card",
        "CreditCard",
        "Credits",
        "DebitCard",
        "Cheque",
        "Online Gateway",
        "PayPal",
        "Razorpay",
        "Stripe",
        "Other"
      ],
      default: "Bank Transfer",
      index: true,
    },

    paymentGatewayRef: { type: String, trim: true, index: { unique: true, sparse: true } },
    referenceNumber: { type: String, trim: true },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, required: true },

    // Aggregates from Zoho / local
    applied_total: { type: Number, default: 0 },
    unused_amount: { type: Number, default: 0 },

    currency: { type: String, default: "INR" },
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
    images: [{ type: String }],

    customer_id: { type: String, index: true },
    zoho_payment_id: { type: String, index: true },
    payment_number: { type: String },
    zoho_status: { type: String },
    deposit_to_account_id: { type: String },

    // Optional: track refunds against excess/unused
    refunds: [
      {
        amount: { type: Number },
        date: { type: Date },
        mode: { type: String },
        reference_number: { type: String },
        zoho_refund_id: { type: String },
        notes: { type: String },
      },
    ],

    idempotency_key: { type: String, unique: true, sparse: true },
    raw_zoho_response: { type: mongoose.Schema.Types.Mixed },

    source: {
      type: String,
      enum: ["manual", "zoho_books", "webhook", "migration"],
      default: "manual"
    },
    // Withholding (for single-invoice payments). For multi-invoice, use invoices[].
    tax_deducted: { type: Boolean, default: false },
    tax_amount_withheld: { type: Number, default: 0 },
    // Convenience aggregate for multi-invoice distributions
    tax_amount_withheld_total: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: "payments",
  }
);

export default mongoose.model("Payment", paymentSchema);
