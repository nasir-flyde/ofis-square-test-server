import mongoose from "mongoose";
const { Schema } = mongoose;

const VisitorPassSchema = new Schema(
  {
    visitorId: { type: Schema.Types.ObjectId, ref: "Visitor", index: true },
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },

    cardId: { type: Schema.Types.ObjectId, ref: "RFIDCard", index: true }, // optional if RFID is used
    qrTokenHash: { type: String, index: true }, // optional if QR-only

    policyId: { type: Schema.Types.ObjectId, ref: "AccessPolicy", index: true },
    accessPointIds: [{ type: Schema.Types.ObjectId, ref: "AccessPoint", index: true }],

    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },

    status: { type: String, enum: ["ACTIVE", "EXPIRED", "REVOKED"], default: "ACTIVE", index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "visitor_passes" }
);

export default mongoose.model("VisitorPass", VisitorPassSchema);
