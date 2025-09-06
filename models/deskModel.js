import mongoose from "mongoose";

const { Schema } = mongoose;

const DeskSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    cabin: { type: Schema.Types.ObjectId, ref: "Cabin", required: true, index: true },
    number: { type: String, required: true, trim: true, index: true },

    status: {
      type: String,
      enum: ["available", "occupied", "maintenance"],
      default: "available",
      index: true,
    },
    allocatedAt: { type: Date },
    releasedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "desks",
  }
);

// Desk number should be unique within a cabin
DeskSchema.index({ cabin: 1, number: 1 }, { unique: true });

export default mongoose.model("Desk", DeskSchema);
