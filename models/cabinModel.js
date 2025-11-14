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
      enum: ["available", "blocked", "occupied", "maintenance"],
      default: "available",
      index: true,
    },
    desks: [{ type: Schema.Types.ObjectId, ref: "Desk", default: [] }],

    allocatedTo: { type: Schema.Types.ObjectId, ref: "Client", default: null, index: true },
    contract: { type: Schema.Types.ObjectId, ref: "Contract", default: null, index: true },
    allocatedAt: { type: Date },
    releasedAt: { type: Date },

    // Cabin blocks (inline subdocuments to avoid a new model)
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

// Ensure cabin number is unique within a building
CabinSchema.index({ building: 1, number: 1 }, { unique: true });

export default mongoose.model("Cabin", CabinSchema);
