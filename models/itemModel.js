import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    rate: { type: Number, default: 0 },
    zoho_item_id: { type: String, trim: true }, // Zoho Books Item ID
    sku: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "items",
  }
);

export default mongoose.model("Item", itemSchema);
