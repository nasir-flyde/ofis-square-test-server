import mongoose from "mongoose";

const { Schema } = mongoose;

const cancelledBookingSchema = new Schema(
  {
    booking: { type: Schema.Types.ObjectId, ref: "MeetingBooking", required: true, index: true, unique: true },
    room: { type: Schema.Types.ObjectId, ref: "MeetingRoom", required: true, index: true },
    building: { type: Schema.Types.ObjectId, ref: "Building", index: true },

    // Original timing of the booking
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true, index: true },

    // Status transition
    statusBefore: { type: String, enum: ["payment_pending", "booked", "cancelled", "completed"], index: true },
    statusAfter: { type: String, default: "cancelled", index: true },

    // Cancellation metadata
    cancelledAt: { type: Date, default: Date.now, index: true },
    cancelledBy: { type: String, trim: true }, // e.g. "partner:myhq", "user:<id>"
    cancellationReason: { type: String, trim: true },

    // External partner context
    externalSource: { type: String, trim: true, index: true }, // e.g. 'myhq'
    referenceNumber: { type: String, trim: true, index: true },

    // Snapshot for auditing/reporting
    snapshot: {
      currency: { type: String },
      amount: { type: Number },
      payment: { type: Schema.Types.Mixed },
      visitorsCount: { type: Number },
      notes: { type: String },
    },
  },
  { timestamps: true, collection: "cancelled_bookings" }
);

cancelledBookingSchema.index({ building: 1, cancelledAt: -1 });
cancelledBookingSchema.index({ externalSource: 1, referenceNumber: 1 });

export default mongoose.model("CancelledBooking", cancelledBookingSchema);
