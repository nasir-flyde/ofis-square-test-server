import mongoose from "mongoose";

const { Schema } = mongoose;

const BuildingAmenitySchema = new Schema(
  {
    name: { 
      type: String, 
      required: true,
      trim: true,
      unique: true
    },
    icon: { 
      type: String,
      trim: true
    },
    iconUrl: {
      type: String,
      trim: true
    },
    description: { 
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "buildingamenities",
  }
);

// Index for efficient querying
BuildingAmenitySchema.index({ name: 1 });
BuildingAmenitySchema.index({ isActive: 1 });

export default mongoose.model("BuildingAmenity", BuildingAmenitySchema);
