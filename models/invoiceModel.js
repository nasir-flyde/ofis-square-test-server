import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    zohoInvoiceId: { type: String, trim: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["unpaid", "paid", "overdue"],
      default: "unpaid",
      index: true,
    },
    dueDate: { type: Date },
    invoiceUrl: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: "invoices",
  }
);

export default mongoose.model("Invoice", invoiceSchema);
