import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    roleName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    canLogin: {
      type: Boolean,
      default: true,
    },
    permissions: {
      type: [String],
      default: [],
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "roles",
  }
);

export default mongoose.model("Role", roleSchema);
