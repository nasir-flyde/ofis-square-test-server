import mongoose from "mongoose";

const AccessPolicySchema = new mongoose.Schema(
  {
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    accessPointIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "AccessPoint" }], default: [] }, 
    allowedFromTime: { type: String }, // "09:00"
    allowedToTime: { type: String },   // "21:00"
    zoneIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "AccessZone" }], default: [] },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "AccessSchedule" },
    holidayCalendarId: { type: mongoose.Schema.Types.ObjectId, ref: "HolidayCalendar" },
    isDefaultForBuilding: { type: Boolean, default: false, index: true },

    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },
  },
  { timestamps: true, collection: "access_policies" }
);

export default mongoose.model("AccessPolicy", AccessPolicySchema);
