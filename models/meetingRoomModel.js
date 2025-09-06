import mongoose from "mongoose";

const { Schema } = mongoose;

const pricingSchema = new Schema(
  {
    currency: { type: String, default: "INR" },
    hourlyRate: { type: Number, default: 0 },
    dailyRate: { type: Number, default: 0 },
  },
  { _id: false }
);

const availabilitySchema = new Schema(
  {
    // 0=Sun ... 6=Sat
    daysOfWeek: { type: [Number], default: [1, 2, 3, 4, 5] },
    openTime: { type: String, default: "09:00" }, // HH:mm (24h)
    closeTime: { type: String, default: "19:00" },
    bufferMinutes: { type: Number, default: 15 },
    minBookingMinutes: { type: Number, default: 30 },
    maxBookingMinutes: { type: Number, default: 480 }
  },
  { _id: false }
);

const meetingRoomSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true },
    amenities: { type: [String], default: [] },
    pricing: { type: pricingSchema, default: () => ({}) },
    availability: { type: availabilitySchema, default: () => ({}) },
    blackoutDates: { type: [Date], default: [] },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
  },
  { timestamps: true, collection: "meeting_rooms" }
);

meetingRoomSchema.index({ building: 1, name: 1 }, { unique: true, sparse: true });

export default mongoose.model("MeetingRoom", meetingRoomSchema);
