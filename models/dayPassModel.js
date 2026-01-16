import mongoose from "mongoose";

const { Schema } = mongoose;

const dayPassSchema = new Schema(
  {
    // Core references - customer can be Guest or Member
    customer: { type: Schema.Types.ObjectId, required: true },
    member: { type: Schema.Types.ObjectId, ref: "Member", default: null },
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true },
    bundle: { type: Schema.Types.ObjectId, ref: "DayPassBundle", default: null }, // null for single passes
    // Inventory reference (subdocument _id from Building.dayPassInventories)
    inventoryId: { type: String, index: true },
    
    // Pass details
    date: { type: Date, default: null },
    visitDate: { type: Date, default: null }, 
    bookingFor: { type: String, enum: ["self", "other"], default: "self" }, 
    expiresAt: { type: Date, required: true },
    price: { type: Number, required: true },
    currency: { type: String },
    // Linked visitors (history of visitor records associated with this pass)
    visitors: [{ type: Schema.Types.ObjectId, ref: "Visitor" }],
    // Status and lifecycle
    status: {
      type: String,
      enum: ["pending", "payment_pending", "issued", "invited", "active", "checked_in", "checked_out", "expired", "cancelled"],
      default: "pending",
      index: true
    },
    invitedAt: { type: Date },
    qrCode: { type: String, unique: true, sparse: true },
    visitorName: { type: String },
    visitorPhone: { type: String },
    visitorEmail: { type: String },
    visitorCompany: { type: String },
    purpose: { type: String },
    
    // Draft visitor details for "other" bookings before issuance
    visitorDetailsDraft: {
      name: { type: String },
      phone: { type: String },
      email: { type: String },
      company: { type: String },
      purpose: { type: String }
    },
    visitorCreated: { type: Boolean, default: false }, // Track if visitor record was created
    numberOfGuests: { type: Number, default: 1, min: 1 },
    expectedArrivalTime: { type: Date },
    expectedDepartureTime: { type: Date },
    qrExpiresAt: { type: Date },
    
    // Check-in/out tracking
    checkInTime: { type: Date },
    checkOutTime: { type: Date },
    
    // Financial
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
    
    // Building access flags
    buildingAccess: {
      wifiAccess: { type: Boolean, default: false },
      accessControl: { type: Boolean, default: false }
    },
    
    // Additional info
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    externalSource: { type: String, index: true },
    referenceNumber: { type: String, index: true },
  },
  { 
    timestamps: true, 
    collection: "daypasses" 
  }
);

// Indexes for efficient queries
dayPassSchema.index({ customer: 1, date: 1 });
dayPassSchema.index({ building: 1, date: 1, status: 1 });
dayPassSchema.index({ bundle: 1 });
dayPassSchema.index({ qrCode: 1 }, { sparse: true });
dayPassSchema.index({ status: 1, date: 1 });
// Ensure idempotency per external partner (unique combination when provided)
dayPassSchema.index({ externalSource: 1, referenceNumber: 1 }, { unique: true, sparse: true });
dayPassSchema.index({ inventoryId: 1 });

const DayPass = mongoose.model("DayPass", dayPassSchema);
export default DayPass;
