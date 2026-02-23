import mongoose from "mongoose";

const PrivacyPolicySchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        paragraphs: [{ type: String, required: true, trim: true }],
    },
    {
        timestamps: true,
        collection: "privacy_policies",
    }
);

export default mongoose.model("PrivacyPolicy", PrivacyPolicySchema);
