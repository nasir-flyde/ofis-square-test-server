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
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        index: '2dsphere'
      }
    },

    totalFloors: { type: Number },
    amenities: [{ type: String }],
    pricing: { 
      type: Number, 
      min: 0,
      default: null 
    },
    openSpacePricing: {
      type: Number,
      min: 0,
      default: null
    },
    photos: [{
      category: { type: String, required: true, trim: true },
      imageUrl: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now }
    }],

    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
  },
  {
    timestamps: true,
    collection: "buildings",
  }
);

export default mongoose.model("Building", BuildingSchema);
