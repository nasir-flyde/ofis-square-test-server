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
  invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
  payment: {
    method: { type: String, enum: ["cash", "card", "credits"], default: "cash" },
    coveredCredits: { type: Number },
    extraCredits: { type: Number },
    overageAmount: { type: Number },
    valuePerCredit: { type: Number },
    idempotencyKey: { type: String },
    amount: { type: Number }
  },
    notes: { type: String, trim: true },
  },
  { timestamps: true, collection: "meeting_bookings" }
);

meetingBookingSchema.index({ room: 1, start: 1, end: 1 });

export default mongoose.model("MeetingBooking", meetingBookingSchema);
