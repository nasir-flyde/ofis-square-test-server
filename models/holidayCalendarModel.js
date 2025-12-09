import mongoose from "mongoose";
const { Schema } = mongoose;

const HolidayCalendarSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    name: { type: String, required: true, trim: true },
    dates: [{ type: Date }],
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "holiday_calendars" }
);

export default mongoose.model("HolidayCalendar", HolidayCalendarSchema);
