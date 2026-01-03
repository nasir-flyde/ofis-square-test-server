import mongoose from "mongoose";

const meetingRoomPricingSchema = new mongoose.Schema({
  meetingRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MeetingRoom", // Assuming you have a MeetingRoom model
    required: true,
    unique: true,
    index: true
  },
  creditsPerHour: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: "Credits per hour must be a positive integer"
    }
  },
  currency: {
    type: String,
    default: "INR"
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
meetingRoomPricingSchema.index({ meetingRoom: 1 }, { unique: true });
meetingRoomPricingSchema.index({ active: 1 });

const MeetingRoomPricing = mongoose.model("MeetingRoomPricing", meetingRoomPricingSchema);

export default MeetingRoomPricing;
