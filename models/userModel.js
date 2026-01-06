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
      unique: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
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
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// Export as "User" to match the ref in memberModel
export default mongoose.model("User", userSchema);
