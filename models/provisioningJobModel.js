import mongoose from "mongoose";
const { Schema } = mongoose;

const ProvisioningJobSchema = new Schema(
  {
    vendor: { type: String, enum: ["MATRIX_COSEC", "OTHER"], required: true, index: true },
    jobType: { type: String, enum: ["UPSERT_USER", "ASSIGN_CARD", "REVOKE_CARD", "SYNC_POLICY", "SYNC_ACCESS_LIST"], required: true, index: true },

    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "RFIDCard", index: true },
    policyId: { type: Schema.Types.ObjectId, ref: "AccessPolicy", index: true },
    accessPointId: { type: Schema.Types.ObjectId, ref: "AccessPoint", index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: "MatrixDevice", index: true },

    payload: { type: Schema.Types.Mixed },
    status: { type: String, enum: ["PENDING", "IN_PROGRESS", "DONE", "FAILED", "RETRY"], default: "PENDING", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    scheduledFor: { type: Date, index: true },
  },
  { timestamps: true, collection: "provisioning_jobs" }
);

ProvisioningJobSchema.index({ status: 1, scheduledFor: 1, vendor: 1 });

export default mongoose.model("ProvisioningJob", ProvisioningJobSchema);
