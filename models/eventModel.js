import mongoose from 'mongoose';

const { Schema } = mongoose;

const EventSchema = new Schema({
  title: { type: String, required: true }, 
  description: { type: String },
  category: { type: Schema.Types.ObjectId, ref: "EventCategory" },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  // Unified location field
  location: {
    building: { type: Schema.Types.ObjectId, ref: "Building" },   // optional
    room: { type: Schema.Types.ObjectId, ref: "MeetingRoom" },    // optional
    address: { type: String }                                     // for external venue
  },

  capacity: { type: Number, default: 0 }, // 0 = unlimited
  rsvps: [{ type: Schema.Types.ObjectId, ref: "Member" }],
  attendance: [{ type: Schema.Types.ObjectId, ref: "Member" }],

  creditsRequired: { type: Number, default: 0 }, 
  status: { type: String, enum: ["draft", "published", "completed", "cancelled"], default: "draft" },

  // Image fields
  thumbnail: { type: String }, // ImageKit URL for thumbnail image
  mainImage: { type: String }, // ImageKit URL for main/banner image

  createdBy: { type: Schema.Types.ObjectId, ref: "User" }, 
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Validation: endDate must be after startDate
EventSchema.path('endDate').validate(function (value) {
  if (this.startDate && value) {
    return value > this.startDate;
  }
  return true;
}, 'endDate must be after startDate');

// Update timestamp on save
EventSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for RSVP count
EventSchema.virtual('rsvpCount').get(function() {
  return this.rsvps ? this.rsvps.length : 0;
});

// Virtual for attendance count
EventSchema.virtual('attendanceCount').get(function() {
  return this.attendance ? this.attendance.length : 0;
});

// Virtual for availability check
EventSchema.virtual('isAvailable').get(function() {
  if (this.capacity === 0) return true; // unlimited capacity
  return this.rsvpCount < this.capacity;
});

// Ensure virtuals are included in JSON output
EventSchema.set('toJSON', { virtuals: true });
EventSchema.set('toObject', { virtuals: true });

// Indexes for efficient querying
EventSchema.index({ status: 1, startDate: 1 });
EventSchema.index({ 'location.building': 1, startDate: 1 });
EventSchema.index({ 'location.room': 1, startDate: 1 });
EventSchema.index({ category: 1, status: 1 });
EventSchema.index({ createdBy: 1 });
EventSchema.index({ rsvps: 1 });
EventSchema.index({ title: 'text', description: 'text' }); // search

const Event = mongoose.model('Event', EventSchema);
export default Event;
