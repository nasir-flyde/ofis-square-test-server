import mongoose from "mongoose";

const taxSchema = new mongoose.Schema({
  tax_name: { type: String },
  tax_percentage: { type: Number },
  tax_amount: { type: Number },
  tax_id: { type: String },
});

const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true },
  item_id: { type: String },
  name: { type: String },
  rate: { type: Number },
  unit: { type: String },
  tax_id: { type: String },
  tax_name: { type: String },
  tax_type: { type: String },
  tax_percentage: { type: Number },
  item_total: { type: Number },
});

const invoiceSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest" },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract" },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },
    cabin: { type: mongoose.Schema.Types.ObjectId, ref: "Cabin" },
    invoice_number: { type: String }, // Our internal invoice number (local sequence)
    reference_number: { type: String },
    source: { type: String, enum: ["local", "zoho", "webhook"], default: "local" },
    type: { type: String, enum: ["regular", "credit_monthly"], default: "regular" },
    category: { 
      type: String, 
      enum: ["general", "day_pass", "meeting_room", "printing", "amenities", "other", "exceeded_credits", "custom_services"],
      default: "general"
    },
    date: { type: Date, default: Date.now },
    due_date: { type: Date },
    billing_period: {
      start: { type: Date },
      end: { type: Date },
    },
    customer_id: { type: String },
    gst_treatment: { type: String },
    place_of_supply: { type: String },
    gst_no: { type: String },
    line_items: [lineItemSchema],
    sub_total: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    discount_type: { type: String, enum: ["entity_level", "item_level"], default: "entity_level" },
    tax_total: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    amount_paid: { type: Number, default: 0 },
    currency_code: { type: String, default: "INR" },
    exchange_rate: { type: Number, default: 1 },
    salesperson_name: { type: String },
    notes: { type: String },
    terms: { type: String },
    status: {
      type: String,
      enum: ["draft", "sent", "partially_paid", "paid", "issued", "overdue", "void"],
      default: "draft",
    },
    zoho_invoice_id: { type: String, index: true },
    zoho_invoice_number: { type: String },
    zoho_status: { type: String },
    zoho_pdf_url: { type: String },
    invoice_url: { type: String },
    // E-Invoice upload (manual or via storage)
    e_invoice_url: { type: String },
    template_id: { type: String },
    payment_terms: { type: Number },
    payment_terms_label: { type: String },
    payment_expected_date: { type: Date },
    last_payment_date: { type: Date },
    shipping_charge: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    adjustment_description: { type: String },
    tax_authority_id: { type: String },
    tax_exemption_id: { type: String },
    is_inclusive_tax: { type: Boolean, default: false },
    billing_address: {
      attention: { type: String },
      address: { type: String },
      street2: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      country: { type: String },
      phone: { type: String }
    },
    shipping_address: {
      attention: { type: String },
      address: { type: String },
      street2: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      country: { type: String },
      phone: { type: String }
    },
    sent_at: { type: Date },
    paid_at: { type: Date },
    payment_id: { type: String },
  },
  { timestamps: true }
);

// Add unique constraint for zoho_invoice_id to prevent duplicates
invoiceSchema.index({ zoho_invoice_id: 1 }, { unique: true, sparse: true });

// Add unique constraint for credit monthly invoices (one per client per month per category)
invoiceSchema.index(
  { client: 1, "billing_period.start": 1, "billing_period.end": 1, type: 1, category: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { type: "credit_monthly" },
    name: "unique_credit_monthly_invoice_by_category"
  }
);

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
