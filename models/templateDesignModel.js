import mongoose from "mongoose";

const { Schema } = mongoose;

const templateDesignSchema = new Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        name: { type: String, required: true, trim: true },
        description: { type: String },
        type: { type: String, required: true }, // e.g., email_base
        category: {
            type: String,
            enum: ["system", "booking", "marketing", "announcement", "transactional"],
            default: "system",
        },
        html: { type: String, required: true }, // The base HTML structure with {{bodyHtml}}
        placeholders: [{ type: String }],
        logoUrl: { type: String },
        logoUrlDark: { type: String },
        address: { type: String },
        isActive: { type: Boolean, default: true },
        isDefault: { type: Boolean, default: false },
        version: { type: Number, default: 1 },
        theme: {
            primaryColor: { type: String },
            backgroundColor: { type: String },
            primaryColorDark: { type: String },
            backgroundColorDark: { type: String },
        },
        createdBy: { type: Schema.Types.ObjectId, ref: "User" },
        updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true }
);

templateDesignSchema.index({ key: 1 }, { unique: true });
templateDesignSchema.index({ name: 1 });
templateDesignSchema.index({ category: 1 });

const TemplateDesign = mongoose.model("TemplateDesign", templateDesignSchema);

export default TemplateDesign;
