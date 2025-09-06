import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true }, // quantity * unitPrice
});

const discountSchema = new mongoose.Schema({
  type: { type: String, enum: ["percent", "flat"], default: "flat" },
  value: { type: Number, default: 0 },
  amount: { type: Number, default: 0 }, // computed
});

const taxSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., GST
  rate: { type: Number, required: true }, // percentage
  amount: { type: Number, required: true }, // computed
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, required: true }, // e.g., "INV-2025-09-0001"
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest" },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract" },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },
    cabin: { type: mongoose.Schema.Types.ObjectId, ref: "Cabin" },

    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    billingPeriod: {
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },

    items: [lineItemSchema],
    subtotal: { type: Number, default: 0 },

    discount: discountSchema,
    taxes: [taxSchema],

    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["draft", "issued", "paid", "overdue", "void"],
      default: "draft",
    },
    notes: { type: String },

    // Zoho Books integration fields
    zohoInvoiceId: { type: String, index: true },
    zohoInvoiceNumber: { type: String },
    zohoStatus: { type: String },
    zohoPdfUrl: { type: String },
    invoiceUrl: { type: String },
    sentAt: { type: Date },
    paidAt: { type: Date },
    paymentId: { type: String },
  },
  { timestamps: true }
);

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
