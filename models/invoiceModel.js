import mongoose from "mongoose";

const taxSchema = new mongoose.Schema({
  tax_name: { type: String }, // GST 18%
  tax_percentage: { type: Number },
  tax_amount: { type: Number },
  tax_id: { type: String }, // Zoho Books tax_id
});

const lineItemSchema = new mongoose.Schema({
  // Local fields
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  amount: { type: Number, required: true }, // quantity * unitPrice
  
  // Zoho Books line item fields
  item_id: { type: String }, // Zoho item ID
  name: { type: String }, // Item name in Zoho
  rate: { type: Number }, // Same as unitPrice but Zoho field name
  unit: { type: String }, // Unit of measurement
  tax_id: { type: String }, // Zoho tax ID
  tax_name: { type: String }, // Tax name
  tax_type: { type: String }, // Tax type
  tax_percentage: { type: Number }, // Tax percentage
  item_total: { type: Number }, // Total including tax
});

const invoiceSchema = new mongoose.Schema(
  {
    // Local references
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest" },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract" },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },
    cabin: { type: mongoose.Schema.Types.ObjectId, ref: "Cabin" },

    // Invoice core fields
    invoice_number: { type: String, unique: true }, // Zoho generated or custom
    reference_number: { type: String },
    date: { type: Date, default: Date.now }, // issueDate
    due_date: { type: Date },
    billing_period: {
      start: { type: Date },
      end: { type: Date },
    },

    // Zoho contact/customer mapping
    customer_id: { type: String }, // Zoho Books contact_id
    gst_treatment: { type: String }, // business_gst, consumer, overseas, etc.
    place_of_supply: { type: String }, // e.g., "MH" (Maharashtra)
    gst_no: { type: String },

    // Items
    line_items: [lineItemSchema],
    sub_total: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    discount_type: { type: String, enum: ["entity_level", "item_level"], default: "entity_level" },
    tax_total: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    amount_paid: { type: Number, default: 0 },

    // Other details
    currency_code: { type: String, default: "INR" },
    exchange_rate: { type: Number, default: 1 },
    salesperson_name: { type: String },
    notes: { type: String },
    terms: { type: String },

    // Status
    status: {
      type: String,
      enum: ["draft", "sent", "partially_paid", "paid", "issued"],
      default: "draft",
    },

    // Zoho integration fields
    zoho_invoice_id: { type: String, index: true },
    zoho_invoice_number: { type: String },
    zoho_status: { type: String },
    zoho_pdf_url: { type: String },
    invoice_url: { type: String },
    
    // Additional Zoho Books fields
    template_id: { type: String }, // Zoho template ID
    payment_terms: { type: Number }, // Payment terms in days
    payment_terms_label: { type: String }, // e.g., "Net 30"
    payment_expected_date: { type: Date },
    last_payment_date: { type: Date },
    shipping_charge: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    adjustment_description: { type: String },
    
    // Tax details
    tax_authority_id: { type: String },
    tax_exemption_id: { type: String },
    is_inclusive_tax: { type: Boolean, default: false },
    
    // Address fields
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

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
