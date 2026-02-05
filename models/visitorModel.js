import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;

const visitorSchema = new Schema(
  {
    // Basic visitor information
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    companyName: { type: String, trim: true },

    // Host and purpose information
    hostMember: { type: Schema.Types.ObjectId, ref: "Member", required: false, index: true },
    hostClient: { type: Schema.Types.ObjectId, ref: "Client", required: false, index: true },
    hostGuest: { type: Schema.Types.ObjectId, ref: "Guest", required: false, index: true },
    purpose: { type: String, trim: true }, // e.g., Meeting, Interview, Delivery
    numberOfGuests: { type: Number, default: 1, min: 1 },

    // Visit scheduling
    expectedVisitDate: { type: Date, required: true, index: true },
    expectedArrivalTime: { type: Date },
    expectedDepartureTime: { type: Date },

    // Check-in/out tracking
    checkInTime: { type: Date, index: true },
    checkOutTime: { type: Date, index: true },
    checkInMethod: { type: String, enum: ["qr", "manual"], default: "manual" },

    // Badge and security
    badgeId: { type: String, trim: true, sparse: true, unique: true },
    qrToken: { type: String, unique: true, sparse: true }, // Opaque token for QR scanning
    qrExpiresAt: { type: Date },

    // Status tracking
    status: {
      type: String,
      enum: ["invited", "pending_checkin", "approved", "checked_in", "checked_out", "cancelled", "no_show"],
      default: "invited",
      index: true
    },

    // ID verification (optional)
    idDocumentType: { type: String, trim: true }, // e.g., "passport", "driving_license", "national_id"
    idNumber: { type: String, trim: true },

    // Notes and reasons
    notes: { type: String, trim: true },
    cancelReason: { type: String, trim: true },

    // Processing tracking
    processedByCheckin: { type: Schema.Types.ObjectId, ref: "User" },
    processedByCheckout: { type: Schema.Types.ObjectId, ref: "User" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" }, // Who approved the check-in request
    approvedAt: { type: Date }, // When the check-in was approved
    checkinRequestedAt: { type: Date }, // When visitor requested check-in

    // Audit and metadata
    createdBy: { type: Schema.Types.ObjectId, ref: "User" }, // Community manager/admin who created
    building: { type: Schema.Types.ObjectId, ref: "Building" }, // Which building they're visiting
    dayPass: { type: Schema.Types.ObjectId, ref: "DayPass", index: true },

    // Integration metadata (optional)
    externalSource: { type: String, index: true }, // e.g., 'myhq'
    externalReferenceNumber: { type: String, index: true },
    bookingRole: { type: String, enum: ["primary", "guest"], index: true },

    // profile picture
    profile_picture: { type: String, trim: true },

    // Soft delete
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    collection: "visitors"
  }
);

// Indexes for performance
visitorSchema.index({ status: 1, expectedVisitDate: 1 });
visitorSchema.index({ hostMember: 1, createdAt: -1 });
visitorSchema.index({ hostClient: 1, createdAt: -1 });
visitorSchema.index({ hostGuest: 1, createdAt: -1 });
visitorSchema.index({ dayPass: 1 });
visitorSchema.index({ phone: 1 }, { sparse: true });
visitorSchema.index({ email: 1 }, { sparse: true });
visitorSchema.index({ qrToken: 1 }, { sparse: true, unique: true });
visitorSchema.index({ badgeId: 1 }, { sparse: true, unique: true });

// Virtual for visit duration
visitorSchema.virtual('visitDuration').get(function () {
  if (this.checkInTime && this.checkOutTime) {
    return Math.round((this.checkOutTime - this.checkInTime) / (1000 * 60));
  }
  return null;
});

// Virtual for full name display
visitorSchema.virtual('displayName').get(function () {
  return this.name + (this.companyName ? ` (${this.companyName})` : '');
});

// Pre-save middleware to generate QR token
visitorSchema.pre('save', function (next) {
  if (this.isNew && !this.qrToken) {
    this.qrToken = crypto.randomBytes(16).toString('hex');
    // Set QR expiry to end of expected visit date or 24 hours from now
    const expiryDate = this.expectedVisitDate ? new Date(this.expectedVisitDate) : new Date();
    expiryDate.setHours(23, 59, 59, 999); // End of day
    this.qrExpiresAt = expiryDate;
  }
  next();
});

// Static method to find visitors for today's reception
visitorSchema.statics.findTodaysVisitors = function (date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.find({
    expectedVisitDate: { $gte: startOfDay, $lte: endOfDay },
    deletedAt: null,
    status: { $in: ["invited", "checked_in"] }
  }).populate('hostMember', 'firstName lastName email phone')
    .populate('building', 'name')
    .sort({ expectedArrivalTime: 1, createdAt: 1 });
};

// Static method to check valid transitions
visitorSchema.statics.isValidTransition = function (currentStatus, newStatus) {
  const validTransitions = {
    invited: ["pending_checkin", "checked_in", "cancelled", "no_show"],
    pending_checkin: ["approved", "cancelled"],
    approved: ["checked_in", "cancelled"],
    checked_in: ["checked_out"],
    checked_out: [],
    cancelled: [],
    no_show: []
  };

  return validTransitions[currentStatus]?.includes(newStatus) || false;
};

// Instance method to check if visitor can check in
visitorSchema.methods.canCheckIn = function () {
  return (this.status === 'invited' || this.status === 'approved') &&
    this.qrExpiresAt &&
    this.qrExpiresAt > new Date() &&
    !this.deletedAt;
};

// Instance method to check if visitor can check out
visitorSchema.methods.canCheckOut = function () {
  return this.status === 'checked_in' && !this.deletedAt;
};

export default mongoose.model("Visitor", visitorSchema);
