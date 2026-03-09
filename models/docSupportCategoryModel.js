import mongoose from "mongoose";

const docSupportCategorySchema = new mongoose.Schema(
    {
        name: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            unique: true,
        },
    },
    {
        timestamps: true,
        collection: "doc_support_categories",
    }
);

export default mongoose.model("DocSupportCategory", docSupportCategorySchema);
