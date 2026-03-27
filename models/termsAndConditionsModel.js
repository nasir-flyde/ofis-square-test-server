import mongoose from "mongoose";

const TermsAndConditionsSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        paragraphs: [{ type: String, required: true, trim: true }],
    },
    {
        timestamps: true,
        collection: "terms_and_conditions",
    }
);

export default mongoose.model("TermsAndConditions", TermsAndConditionsSchema);
