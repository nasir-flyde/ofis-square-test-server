import mongoose from "mongoose";

const documentEntitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    fieldName: { type: String, required: true, trim: true, unique: true, index: true },
    entityType: { type: String,index: true },
    required: { type: Boolean, default: false },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "document_entities",
  }
);

export default mongoose.model("DocumentEntity", documentEntitySchema);
