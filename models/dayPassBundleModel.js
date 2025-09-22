import mongoose from "mongoose";

const { Schema } = mongoose;

const dayPassBundleSchema = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: "Guest", required: true },
    member: { type: Schema.Types.ObjectId, ref: "Member", default: null },
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true },
    no_of_dayPasses: { type: Number, required: true, min: 1 },
    remainingPasses: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["payment_pending", "issued", "active", "expired", "cancelled"],
      default: "payment_pending",
      index: true
    },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
    payment: { type: Schema.Types.ObjectId, ref: "Payment" },
    notes: { type: String, trim: true }
  },
  {
    timestamps: true,
    collection: "daypassbundles"
  }
);

// Index for efficient queries
dayPassBundleSchema.index({ customer: 1, status: 1 });
dayPassBundleSchema.index({ validUntil: 1, status: 1 });

const DayPassBundle = mongoose.model("DayPassBundle", dayPassBundleSchema);
export default DayPassBundle;
