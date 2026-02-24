import mongoose from "mongoose";

const { Schema } = mongoose;

const discountBundleSchema = new Schema(
    {
        name: { type: String, required: true },
        description: { type: String },
        building: { type: Schema.Types.ObjectId, ref: "Building", default: null }, // null for global bundles
        bundles: [
            {
                no_of_day_passes: { type: Number, required: true },
                discount_percentage: { type: Number, required: true, min: 0, max: 100 }
            }
        ],
        isActive: { type: Boolean, default: true }
    },
    {
        timestamps: true,
        collection: "discountbundles"
    }
);

const DiscountBundle = mongoose.model("DiscountBundle", discountBundleSchema);
export default DiscountBundle;
