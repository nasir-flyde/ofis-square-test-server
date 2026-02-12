import mongoose from "mongoose";
import { randomUUID } from "crypto";

const { Schema } = mongoose;

const deviceBindingSchema = new Schema(
  {
    vendor: { type: String, enum: ["MATRIX_COSEC", "OTHER"], required: true },
    deviceId: { type: Schema.Types.ObjectId, ref: "MatrixDevice" },
    externalDeviceId: { type: String },
    direction: { type: String, enum: ["ENTRY", "EXIT", "BIDIRECTIONAL"], default: "BIDIRECTIONAL" },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const resourceRefSchema = new Schema(
  {
    refType: {
      type: String,
      enum: ["MeetingRoom", "Cabin", "Desk", "InventoryUnit", "CommonArea", "Custom"],
      default: "Custom",
    },
    refId: { type: Schema.Types.ObjectId, refPath: "resource.refType" },
    label: { type: String },
  },
  { _id: false }
);

const AccessPointSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    uuid: { type: String, unique: true, index: true, default: () => randomUUID() },

    name: { type: String, required: true, trim: true },
    bindingType: {
      type: String,
      enum: ["inventory_unit", "meeting_room", "common_area", "custom", "cabin", "desk"],
      default: "custom",
      index: true,
    },
    resource: resourceRefSchema,
    pointType: {
      type: String,
      enum: ["DOOR", "TURNSTILE", "BARRIER", "ELEVATOR", "MEETING_ROOM", "COMMON_AREA", "CABIN", "DESK", "CUSTOM"],
      default: "DOOR",
      index: true,
    },
    deviceBindings: { type: [deviceBindingSchema], default: [] },

    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    location: {
      floor: { type: Number },
      zone: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "access_points" }
);

AccessPointSchema.index({ buildingId: 1, bindingType: 1, status: 1 });

export default mongoose.model("AccessPoint", AccessPointSchema);
