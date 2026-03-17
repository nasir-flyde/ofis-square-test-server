import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
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
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    deviceInfo: {
      userAgent: String,
      ipAddress: String,
    },
    family: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "refresh_tokens",
  }
);

// TTL index to automatically delete expired tokens after 30 days
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 2592000 });

// Static method to clean up expired tokens
refreshTokenSchema.statics.cleanupExpired = async function() {
  const now = new Date();
  return this.deleteMany({ expiresAt: { $lt: now } });
};

// Static method to revoke all tokens for a user (logout all devices)
refreshTokenSchema.statics.revokeAllForUser = async function(userId) {
  return this.updateMany(
    { userId, isRevoked: false },
    { isRevoked: true }
  );
};

// Static method to revoke token family (detect token theft)
refreshTokenSchema.statics.revokeFamily = async function(family) {
  return this.updateMany(
    { family, isRevoked: false },
    { isRevoked: true }
  );
};

export default mongoose.model("RefreshToken", refreshTokenSchema);
