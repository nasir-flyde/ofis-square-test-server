import mongoose from "mongoose";

const CitySchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true, trim: true },
        state: { type: String, required: true, trim: true },
        country: { type: String, default: "India", trim: true },
        isActive: { type: Boolean, default: true },
    },
    {
        timestamps: true,
        collection: "cities",
    }
);

export default mongoose.model("City", CitySchema);
