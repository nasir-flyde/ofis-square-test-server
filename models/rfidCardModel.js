import mongoose from "mongoose";
const { Schema } = mongoose;

const RFIDCardSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", index: true },

    cardUid: { type: String, required: true, trim: true, unique: true, index: true },
    facilityCode: { type: String, trim: true },
    technology: { type: String, enum: ["EM4100", "MIFARE", "HID", "ISO14443", "GENERIC"], default: "GENERIC" },
    cardType: { type: String, enum: ["PHYSICAL", "MOBILE", "VIRTUAL"], default: "PHYSICAL" },

    status: { type: String, enum: ["ISSUED", "ACTIVE", "SUSPENDED", "REVOKED", "LOST", "DAMAGED", "EXPIRED"], default: "ISSUED", index: true },
    issuedAt: { type: Date },
    activatedAt: { type: Date },
    suspendedAt: { type: Date },
    revokedAt: { type: Date },
    expiresAt: { type: Date },
    replacedById: { type: Schema.Types.ObjectId, ref: "RFIDCard" },

    // Matrix devices this card is associated with
    devices: [{ type: Schema.Types.ObjectId, ref: "MatrixDevice" }],

    lastSeenAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "rfid_cards" }
);

RFIDCardSchema.index({ buildingId: 1, status: 1 });

export default mongoose.model("RFIDCard", RFIDCardSchema);
