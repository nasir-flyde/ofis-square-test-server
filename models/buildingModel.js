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
    coordinates: {
      longitude: { type: Number },
      latitude: { type: Number }
    },
    businessMapLink: { type: String },

    totalFloors: { type: Number },
    amenities: [{ type: Schema.Types.ObjectId, ref: "BuildingAmenity" }],
    perSeatPricing: { 
      type: Number, 
      min: 0,
      default: null 
    },
    openSpacePricing: {
      type: Number,
      min: 0,
      default: null
    },
    // Credit system: value per credit (INR) for this building
    creditValue: {
      type: Number,
      min: 0,
      default: 500
    },
    photos: [{
      category: { type: String, required: true, trim: true },
      imageUrl: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now }
    }],

    status: { type: String, enum: ["draft", "active", "inactive"], default: "draft", index: true },
  },
  {
    timestamps: true,
    collection: "buildings",
  }
);

export default mongoose.model("Building", BuildingSchema);
