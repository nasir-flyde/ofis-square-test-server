import mongoose from "mongoose";

const dayPassSchema = new mongoose.Schema(
  {
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "Guest", required: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true },
    date: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "used", "expired", "cancelled"],
      default: "active",
    },
    checkInTime: { type: Date },
    checkOutTime: { type: Date },
    price: { type: Number, required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
  },
  { timestamps: true, collection: "daypasses" }
);

const DayPass = mongoose.model("DayPass", dayPassSchema);
export default DayPass;
