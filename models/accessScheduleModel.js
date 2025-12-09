import mongoose from "mongoose";
const { Schema } = mongoose;

const dayWindowSchema = new Schema(
  {
    start: { type: String, required: true }, // HH:mm
    end: { type: String, required: true },   // HH:mm
  },
  { _id: false }
);

const dayRuleSchema = new Schema(
  {
    dayOfWeek: { type: Number, required: true }, // 0=Sun..6=Sat
    windows: { type: [dayWindowSchema], default: [] },
  },
  { _id: false }
);

const AccessScheduleSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    name: { type: String, required: true, trim: true },
    rules: { type: [dayRuleSchema], default: [] },
    timezone: { type: String, default: "Asia/Kolkata" },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "access_schedules" }
);

export default mongoose.model("AccessSchedule", AccessScheduleSchema);
