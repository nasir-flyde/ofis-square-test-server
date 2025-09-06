import mongoose from "mongoose";

const guestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    companyName: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: "guests",
  }
);

const Guest = mongoose.model("Guest", guestSchema);
export default Guest;
