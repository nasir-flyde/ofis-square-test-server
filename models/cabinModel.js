import mongoose from "mongoose";

const { Schema } = mongoose;

const CabinSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    floor: { type: Number },
    number: { type: String, required: true, trim: true, index: true },
    // Cabin type is now fixed to 'cabin' (Desks are a separate model)
    type: { type: String, enum: ["cabin","private","shared"], default: "cabin", index: true },
    capacity: { type: Number, default: 1 },

    // Category and classification
    category: { type: String, trim: true }, // e.g., "Standard", "Premium", "Executive"
    
    // Physical specifications
    sizeSqFt: { type: Number }, // Size in square feet
    
    // Amenities (references to CabinAmenity documents)
    amenities: [{ type: Schema.Types.ObjectId, ref: "CabinAmenity" }],
    
    // Images
    images: [
      {
        url: { type: String },
        caption: { type: String },
        isPrimary: { type: Boolean, default: false },
      },
    ],
    
    // Pricing
    pricing: { type: Number }, // Single pricing field

    status: {
      type: String,
      enum: ["available", "occupied", "maintenance"],
      default: "available",
      index: true,
    },

    // References to Desk documents contained within this cabin
    desks: [{ type: Schema.Types.ObjectId, ref: "Desk", default: [] }],

    allocatedTo: { type: Schema.Types.ObjectId, ref: "Client", default: null, index: true },
    contract: { type: Schema.Types.ObjectId, ref: "Contract", default: null, index: true },
    allocatedAt: { type: Date },
    releasedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: "cabins",
  }
);

// Ensure cabin number is unique within a building
CabinSchema.index({ building: 1, number: 1 }, { unique: true });

export default mongoose.model("Cabin", CabinSchema);
