import mongoose from "mongoose";

const { Schema } = mongoose;

const dayPassDailyUsageSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    date: { type: Date, required: true, index: true }, // store the day (start of day in IST or UTC-consistent)

    dayPass: { type: Schema.Types.ObjectId, ref: "DayPass", required: true, unique: true },
    seats: { type: Number, default: 1, min: 1 },

    // Partner idempotency context
    externalSource: { type: String, index: true }, // e.g., 'myhq'
    referenceNumber: { type: String, index: true },
  },
  { timestamps: true, collection: "daypassdailyusages" }
);

// For fast lookups by building/date
dayPassDailyUsageSchema.index({ building: 1, date: 1 });

const DayPassDailyUsage = mongoose.model("DayPassDailyUsage", dayPassDailyUsageSchema);
export default DayPassDailyUsage;
