import mongoose from "mongoose";

const { Schema } = mongoose;

const dayPassDailyUsageSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true },
    date: { type: Date, required: true }, // store the day (start of day in IST or UTC-consistent)

    dayPass: { type: Schema.Types.ObjectId, ref: "DayPass" },
    // Optional back-reference when usage is created from a Day Pass Bundle
    bundle: { type: Schema.Types.ObjectId, ref: "DayPassBundle" },
    seats: { type: Number, default: 1, min: 1 },

    // Partner idempotency context
    externalSource: { type: String, index: true }, // e.g., 'myhq'
    referenceNumber: { type: String, index: true },
  },
  { timestamps: true, collection: "daypassdailyusages" }
);

// Keep uniqueness for per-pass usage rows when dayPass is present
dayPassDailyUsageSchema.index({ dayPass: 1 }, { unique: true, partialFilterExpression: { dayPass: { $exists: true, $ne: null } } });

const DayPassDailyUsage = mongoose.model("DayPassDailyUsage", dayPassDailyUsageSchema);
export default DayPassDailyUsage;
