import mongoose from "mongoose";

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

const estimateSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract", index: true, default: null },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true, default: null },

    estimate_number: { type: String, index: true },
    reference_number: { type: String },
    source: { type: String, enum: ["local", "zoho", "webhook"], default: "local" },

    date: { type: Date, default: Date.now },
    expiry_date: { type: Date },

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
    currency_code: { type: String, default: "INR" },
    exchange_rate: { type: Number, default: 1 },

    notes: { type: String },
    terms: { type: String },

    status: {
      type: String,
      enum: ["draft", "sent", "accepted", "declined", "expired", "approved_internal", "invoiced"],
      default: "draft",
      index: true,
    },

    // Zoho fields for estimates
    zoho_estimate_id: { type: String, index: true, sparse: true },
    zoho_estimate_number: { type: String },
    zoho_status: { type: String },
    zoho_pdf_url: { type: String },
    estimate_url: { type: String },

    billing_address: {
      attention: { type: String },
      address: { type: String },
      street2: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      country: { type: String },
      phone: { type: String },
    },
    shipping_address: {
      attention: { type: String },
      address: { type: String },
      street2: { type: String },
      city: { type: String },
      state: { type: String },
      zip: { type: String },
      country: { type: String },
      phone: { type: String },
    },
  },
  { timestamps: true }
);

// Unique constraint for Zoho linkage
estimateSchema.index({ zoho_estimate_id: 1 }, { unique: true, sparse: true, name: "unique_zoho_estimate_id" });

// Idempotency indexes for monthly estimates
// One estimate per contract per billing period (month)
estimateSchema.index(
  { contract: 1, "billing_period.start": 1, "billing_period.end": 1 },
  { unique: true, partialFilterExpression: { contract: { $ne: null } }, name: "unique_monthly_estimate_by_contract" }
);

// One consolidated estimate per client+building per billing period
estimateSchema.index(
  { client: 1, building: 1, "billing_period.start": 1, "billing_period.end": 1 },
  { unique: true, partialFilterExpression: { building: { $ne: null } }, name: "unique_monthly_estimate_by_building" }
);

const Estimate = mongoose.model("Estimate", estimateSchema);
export default Estimate;
