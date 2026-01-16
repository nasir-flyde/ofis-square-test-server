import mongoose from "mongoose";

const { Schema } = mongoose;

const DayPassDailyUsageSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: 'Building', required: true, index: true },
    // Always normalized to start-of-day (00:00:00.000)
    date: { type: Date, required: true, index: true },
    bookedCount: { type: Number, required: true, min: 0, default: 0 },
  },
  {
    timestamps: true,
    collection: 'daypass_daily_usages'
  }
);

DayPassDailyUsageSchema.index({ building: 1, date: 1 }, { unique: true });

export default mongoose.model('DayPassDailyUsage', DayPassDailyUsageSchema);
