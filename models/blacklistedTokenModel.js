import mongoose from "mongoose";

const blacklistedTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      enum: ["logout", "refresh", "rotation", "manual_revocation"],
      default: "logout",
    },
  },
  {
    timestamps: true,
    collection: "blacklisted_tokens",
  }
);

// TTL index to automatically delete expired tokens
// This should match the access token lifetime (usually 1 day per process.env.JWT_ACCESS_EXPIRES_IN)
// We add a small buffer (e.g., 1 hour) to be safe.
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("BlacklistedToken", blacklistedTokenSchema);
