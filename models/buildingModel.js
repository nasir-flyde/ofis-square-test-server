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
    creditValue: {
      type: Number,
      min: 0,
      default: 500
    },
    draftInvoiceGeneration: {
      type: Boolean,
      default: false,
      index: true
    },
    draftInvoiceDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 25
    },
    draftInvoiceDueDay: {
      type: Number,
      min: 1,
      max: 31,
      default: 7
    },
    // Late fee policy (per-building defaults)
    lateFeePolicy: {
      enabled: { type: Boolean, default: false },
      gracePeriodDays: { type: Number, default: 0, min: 0 },
      customFormula: { type: String, default: undefined },
      variables: { type: Schema.Types.Mixed, default: undefined },
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
