import mongoose from "mongoose";

const appRequestSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    appName: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const AppRequest = mongoose.model("AppRequest", appRequestSchema);

export default AppRequest;
