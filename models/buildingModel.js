import mongoose from "mongoose";

const { Schema } = mongoose;

const BuildingSchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    country: { type: String, default: "India" },
    pincode: { type: String },

    totalFloors: { type: Number },
    amenities: [{ type: String }],
    pricing: { 
      type: Number, 
      min: 0,
      default: null 
    },

    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
  },
  {
    timestamps: true,
    collection: "buildings",
  }
);

export default mongoose.model("Building", BuildingSchema);
