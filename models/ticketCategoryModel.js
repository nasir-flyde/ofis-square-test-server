import mongoose from "mongoose";

const ticketCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true },
    subCategories: { type: [String], default: [] },
  },
  { timestamps: true, collection: "ticket_categories" }
);

export default mongoose.model("TicketCategory", ticketCategorySchema);
