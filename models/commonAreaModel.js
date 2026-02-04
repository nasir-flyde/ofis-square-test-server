import mongoose from "mongoose";

const { Schema } = mongoose;

const CommonAreaSchema = new Schema(
  {
    buildingId: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    name: { type: String, required: true, trim: true },
    areaType: {
      type: String,
      enum: ["CAFETERIA", "CORRIDOR", "LOBBY", "PANTRY", "LOUNGE", "OTHER"],
      default: "OTHER",
      index: true,
    },
    description: { type: String, trim: true },
    location: {
      floor: { type: Number },
      zone: { type: String, trim: true },
      notes: { type: String, trim: true },
    },
    // Matrix access devices associated with this common area
    matrixDevices: [{ type: Schema.Types.ObjectId, ref: "MatrixDevice", default: [] }],

    images: [
      {
        url: { type: String },
        caption: { type: String },
        isPrimary: { type: Boolean, default: false },
      },
    ],

    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "common_areas" }
);

// CommonAreaSchema.index({ buildingId: 1, name: 1 }, { unique: true, sparse: true });

export default mongoose.model("CommonArea", CommonAreaSchema);
