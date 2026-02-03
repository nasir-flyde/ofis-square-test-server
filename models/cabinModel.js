import mongoose from "mongoose";

const { Schema } = mongoose;

const CabinSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    floor: { type: Number },
    number: { type: String, required: true, trim: true, index: true },
    type: { type: String,default: "cabin", index: true },
    capacity: { type: Number, default: 1 },
    category: { type: String, trim: true },
    sizeSqFt: { type: Number },
    amenities: [{ type: Schema.Types.ObjectId, ref: "CabinAmenity" }],
    images: [
      {
        url: { type: String },
        caption: { type: String },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    pricing: { type: Number },
    status: {
      type: String,
      enum: ["available", "blocked", "occupied", "maintenance"],
      default: "available",
      index: true,
    },
    matrixDevices: [{ type: Schema.Types.ObjectId, ref: "MatrixDevice", default: [] }],
    desks: [{ type: Schema.Types.ObjectId, ref: "Desk", default: [] }],

    allocatedTo: { type: Schema.Types.ObjectId, ref: "Client", default: null, index: true },
    contract: { type: Schema.Types.ObjectId, ref: "Contract", default: null, index: true },
    allocatedAt: { type: Date },
    releasedAt: { type: Date },
    blocks: [
      {
        client: { type: Schema.Types.ObjectId, ref: "Client", required: true },
        contract: { type: Schema.Types.ObjectId, ref: "Contract" },
        fromDate: { type: Date, required: true },
        toDate: { type: Date, required: true },
        status: {
          type: String,
          enum: ["active", "released", "expired", "allocated"],
          default: "active",
        },
        reason: { type: String },
        notes: { type: String },
        createdBy: { type: Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date },
      },
    ],
  },
  {
    timestamps: true,
    collection: "cabins",
  }
);

CabinSchema.index({ building: 1, number: 1 }, { unique: true });

export default mongoose.model("Cabin", CabinSchema);
