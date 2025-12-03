import mongoose from "mongoose";

const { Schema } = mongoose;

const bhaifiDeviceSchema = new Schema(
  {
    bhaifiUser: { type: Schema.Types.ObjectId, ref: "BhaifiUser", required: true, index: true },
    macAddress: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    status: { type: String, enum: ["whitelisted", "revoked"], default: "whitelisted", index: true },
    lastSyncAt: { type: Date },
    lastError: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "bhaifi_devices" }
);

bhaifiDeviceSchema.index({ bhaifiUser: 1, macAddress: 1 }, { unique: true, name: "uq_user_mac" });

export default mongoose.model("BhaifiDevice", bhaifiDeviceSchema);
