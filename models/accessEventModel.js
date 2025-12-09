import mongoose from "mongoose";
const { Schema } = mongoose;

const AccessEventSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },
    vendor: { type: String, enum: ["MATRIX_COSEC", "OTHER"], index: true },
    externalEventId: { type: String, index: true },

    deviceId: { type: Schema.Types.ObjectId, ref: "MatrixDevice", index: true },
    accessPointId: { type: Schema.Types.ObjectId, ref: "AccessPoint", index: true },

    cardUid: { type: String, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", index: true },

    result: { type: String, enum: ["ALLOWED", "DENIED"], index: true },
    reason: { type: String },
    direction: { type: String, enum: ["ENTRY", "EXIT", "UNKNOWN"], default: "UNKNOWN", index: true },

    occurredAt: { type: Date, required: true, index: true },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "access_events" }
);

AccessEventSchema.index({ occurredAt: -1 });

export default mongoose.model("AccessEvent", AccessEventSchema);
