import mongoose from "mongoose";

const { Schema } = mongoose;

const meetingBookingSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "MeetingRoom", required: true, index: true },
    visitors: [{ type: Schema.Types.ObjectId, ref: "Visitor" }],
    member: { type: Schema.Types.ObjectId, ref: "Member", index: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true, index: true },
    amenitiesRequested: { type: [String], default: [] },

    status: { type: String, enum: ["payment_pending", "booked", "cancelled", "completed"], default: "booked", index: true },

    currency: { type: String, default: "INR" },
    amount: { type: Number, default: 0 },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", index: true },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest", index: true },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
    payment: {
      method: { type: String, enum: ["cash", "card", "credits", "razorpay", "online", "postpaid"], default: "cash" },
      coveredCredits: { type: Number },
      extraCredits: { type: Number },
      overageAmount: { type: Number },
      valuePerCredit: { type: Number },
      idempotencyKey: { type: String },
      razorpayOrderId: { type: String },
      amount: { type: Number }
    },
    buildingAccess: {
      wifiAccess: { type: Boolean, default: false },
      matrixAccess: { type: Boolean, default: false }
    },

    usingDefaultBuildingDiscount: { type: Boolean, default: false },
    discountStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none", index: true },
    requestedDiscountPercent: { type: Number, min: 0, max: 100 },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
    requestedReason: { type: String },
    appliedDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvalNotes: { type: String },
    approvedAt: { type: Date },
    notes: { type: String, trim: true },

    externalSource: { type: String, index: true },
    referenceNumber: { type: String, index: true },
  },
  { timestamps: true, collection: "meeting_bookings" }
);

meetingBookingSchema.index({ start: 1, end: 1, status: 1, room: 1 });
meetingBookingSchema.index({ externalSource: 1, referenceNumber: 1 }, { unique: true, sparse: true });
meetingBookingSchema.index(
  { "payment.idempotencyKey": 1, member: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { "payment.idempotencyKey": { $gt: "" } }
  }
);

export default mongoose.model("MeetingBooking", meetingBookingSchema);
