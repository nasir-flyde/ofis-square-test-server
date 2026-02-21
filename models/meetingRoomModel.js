import mongoose from "mongoose";

const { Schema } = mongoose;

const pricingSchema = new Schema(
  {
    currency: { type: String, default: "INR" },
    hourlyRate: { type: Number, default: 0 },
  },

  { _id: false }
);

const timeSlotSchema = new Schema(
  {
    startTime: { type: String, required: true }, // e.g., "09:00 AM"
    endTime: { type: String, required: true },   // e.g., "10:00 AM"
  },
  { _id: false }
);

const reservedSlotSchema = new Schema(
  {
    date: { type: Date, required: true },
    // Denormalized IST day string for clarity in UIs/inspectors, e.g., "2026-01-12"
    dateISTYMD: { type: String },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "MeetingBooking" },
  },
  { _id: false }
);

const availabilitySchema = new Schema(
  {
    // 0=Sun ... 6=Sat
    daysOfWeek: { type: [Number], default: [1, 2, 3, 4, 5] },
    openTime: { type: String, default: "09:00" }, // HH:mm (24h)
    closeTime: { type: String, default: "19:00" },
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
    floor: { type: String, trim: true },
    amenities: {

      type: [{ type: Schema.Types.ObjectId, ref: "CabinAmenity" }],
      default: []
    },
    images: { type: [String], default: [] },
    pricing: { type: pricingSchema, default: () => ({}) },
    availability: { type: availabilitySchema, default: () => ({}) },
    blackoutDates: { type: [Date], default: [] },
    // Matrix access devices associated with this meeting room
    matrixDevices: [{ type: Schema.Types.ObjectId, ref: "MatrixDevice", default: [] }],
    availableTimeSlots: {
      type: [timeSlotSchema],
      default: () => [
        { startTime: "09:00 AM", endTime: "10:00 AM" },
        { startTime: "10:00 AM", endTime: "11:00 AM" },
        { startTime: "11:00 AM", endTime: "12:00 PM" },
        { startTime: "12:00 PM", endTime: "01:00 PM" },
        { startTime: "01:00 PM", endTime: "02:00 PM" },
        { startTime: "02:00 PM", endTime: "03:00 PM" },
        { startTime: "03:00 PM", endTime: "04:00 PM" },
        { startTime: "04:00 PM", endTime: "05:00 PM" },
      ],
    },
    reservedSlots: { type: [reservedSlotSchema], default: [] },
    isBookingClosed: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    // Optional room-level discount cap used for community flows
    communityMaxDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
  },
  { timestamps: true, collection: "meeting_rooms" }
);

meetingRoomSchema.index({ building: 1, status: 1, capacity: 1 });

export default mongoose.model("MeetingRoom", meetingRoomSchema);
