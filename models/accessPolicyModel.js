import mongoose from "mongoose";

const AccessPolicySchema = new mongoose.Schema(
  {
    // Scope policy by Building so it can be reused by multiple clients in the same building
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    accessPointIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "MatrixDevice" }], default: [] }, 

    // Optional: daily time window
    allowedFromTime: { type: String }, // "09:00"
    allowedToTime: { type: String },   // "21:00"

    // Default policy at building scope
    isDefaultForBuilding: { type: Boolean, default: false, index: true },

    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },
  },
  { timestamps: true, collection: "access_policies" }
);

export default mongoose.model("AccessPolicy", AccessPolicySchema);
