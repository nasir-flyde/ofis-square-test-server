import mongoose from "mongoose";

const { Schema } = mongoose;

const MatrixDeviceSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    vendor: { type: String, enum: ["MATRIX_COSEC"], default: "MATRIX_COSEC", index: true },
    // Device type numeric enum as per COSEC API (e.g., 1, 16, 17)
    deviceType: { type: Number, enum: [1, 16, 17], required: true, index: true },
    direction: { type: String, enum: ["ENTRY", "EXIT", "BIDIRECTIONAL"], default: "BIDIRECTIONAL" },
    externalDeviceId: { type: String, trim: true, unique: true, sparse: true, index: true },
    device_id: { type: String, trim: true, unique: true, sparse: true, index: true },
    // Numeric device identifier (preferred for COSEC API `device-id`)
    device: { type: Number, index: true },
    ipAddress: { type: String, trim: true },
    macAddress: { type: String, trim: true },
    // New Field: Maps to "Site" column
    site: { type: String, trim: true },
    location: {
      floor: { type: Number },
      zone: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
    // Modified: Updated default and enum to handle "Active" (Title Case) from Excel
    status: {
      type: String,
      enum: ["active", "inactive", "Active", "Inactive"],
      default: "Active",
      index: true,
      // Optional: setter to normalize case if you prefer all lowercase in DB
      // set: (v) => v.toLowerCase() 
    },
    lastSeenAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "matrix_devices" }
);

MatrixDeviceSchema.index({ buildingId: 1, status: 1 });

export default mongoose.model("MatrixDevice", MatrixDeviceSchema);
