import mongoose from "mongoose";

const { Schema } = mongoose;

const bhaifiNasSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    nasId: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true, collection: "bhaifi_nas_mappings" }
);

bhaifiNasSchema.index({ nasId: 1 }, { name: "ix_nasId" });
bhaifiNasSchema.index({ building: 1, nasId: 1 }, { unique: true, name: "ix_building_nas_unique" });

export default mongoose.model("BhaifiNas", bhaifiNasSchema);
