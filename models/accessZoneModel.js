import mongoose from "mongoose";
const { Schema } = mongoose;

const AccessZoneSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    accessPointIds: [{ type: Schema.Types.ObjectId, ref: "AccessPoint", index: true }],
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "access_zones" }
);

AccessZoneSchema.index({ buildingId: 1, status: 1 });

export default mongoose.model("AccessZone", AccessZoneSchema);
