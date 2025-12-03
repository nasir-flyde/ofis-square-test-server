import mongoose from "mongoose";

const { Schema } = mongoose;

const MatrixDeviceSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    vendor: { type: String, enum: ["MATRIX_COSEC"], default: "MATRIX_COSEC", index: true },
    deviceType: { type: String, enum: ["DOOR_CONTROLLER", "READER", "PANEL"], required: true, index: true },
    direction: { type: String, enum: ["ENTRY", "EXIT", "BIDIRECTIONAL"], default: "BIDIRECTIONAL" },
    externalDeviceId: { type: String, trim: true, unique: true, sparse: true, index: true },
    ipAddress: { type: String, trim: true },
    macAddress: { type: String, trim: true },
    location: {
      floor: { type: Number },
      zone: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    lastSeenAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "matrix_devices" }
);

MatrixDeviceSchema.index({ buildingId: 1, status: 1 });

export default mongoose.model("MatrixDevice", MatrixDeviceSchema);
