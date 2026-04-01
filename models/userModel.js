import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: false,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      trim: true,
    },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: false,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: false,
      index: true,
    },
    profile_picture: {
      url: { type: String },
      fileId: { type: String },
    },
    isAdminVerified: {
      type: Boolean,
      default: true,
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// Ensure uniqueness for (email, role) and (phone, role)
userSchema.index({ email: 1, role: 1 }, { unique: true });
userSchema.index(
  { phone: 1, role: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string", $gt: "" } } }
);

// Export as "User" to match the ref in memberModel
export default mongoose.model("User", userSchema);
