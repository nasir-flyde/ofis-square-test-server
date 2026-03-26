import mongoose from "mongoose";

const addOnSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true, default: "General" },
    isActive: { type: Boolean, default: true },
    quantity: { type: Number, default: 1 },
    zoho_item_id: { type: String, default: "" } // Zoho Books Item ID for this add-on
  },
  {
    timestamps: true,
    collection: "addons",
  }
);

export default mongoose.model("AddOn", addOnSchema);
