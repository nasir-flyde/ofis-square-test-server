import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: false
  },
  phone: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  }
}, {
  timestamps: true
});

// Index for faster lookups
otpSchema.index({ phone: 1, expiresAt: 1 });
otpSchema.index({ email: 1, expiresAt: 1 });

const OTP = mongoose.model("OTP", otpSchema);
export default OTP;
