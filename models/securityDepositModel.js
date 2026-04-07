import mongoose from "mongoose";

const securityDepositSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract", index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },
    cabin: { type: mongoose.Schema.Types.ObjectId, ref: "Cabin", index: true },

    agreed_amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: [
        "AGREED",
        "DUE",
        "PAID",
        "PARTIALLY_ADJUSTED",
        "REFUNDED",
        "FORFEITED",
        "CLOSED",
        "PARTIAL",
        "cash"
      ],
      default: "AGREED",
      index: true,
    },

    due_date: { type: Date },
    paid_date: { type: Date },
    closed_date: { type: Date },


    // Running amounts
    amount_due: { type: Number, default: 0, min: 0 },
    amount_paid: { type: Number, default: 0, min: 0 },
    amount_adjusted: { type: Number, default: 0, min: 0 },
    amount_refunded: { type: Number, default: 0, min: 0 },
    amount_forfeited: { type: Number, default: 0, min: 0 },

    // SD Note artifacts
    sdNoteUrl: { type: String },
    sdNoteGeneratedAt: { type: Date },
    sdNoteMeta: { type: mongoose.Schema.Types.Mixed },

    images: [{ type: String }],

    notes: { type: String, trim: true },

    // Tracking for Zoho recognition
    is_zoho_recognition_done: { type: Boolean, default: false },
    zoho_agreement_journal_id: { type: String },
    zoho_agreement_journal_number: { type: String },
  },
  {
    timestamps: true,
    collection: "security_deposits",
  }
);

// Helpful computed field
securityDepositSchema.virtual("held_balance").get(function () {
  const paid = Number(this.amount_paid || 0);
  const out = Number(this.amount_adjusted || 0) + Number(this.amount_refunded || 0) + Number(this.amount_forfeited || 0);
  return Math.max(0, paid - out);
});

// Indexes
securityDepositSchema.index({ client: 1, contract: 1, status: 1 });

export default mongoose.model("SecurityDeposit", securityDepositSchema);
