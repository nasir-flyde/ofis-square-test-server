import mongoose from "mongoose";

const lateFeeSchema = new mongoose.Schema(
    {
        client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
        contract: { type: mongoose.Schema.Types.ObjectId, ref: "Contract" },
        building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true },
        original_invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", required: true }, // The invoice that is overdue

        date: { type: Date, required: true }, // The date for which this fee applies
        amount: { type: Number, required: true },

        status: {
            type: String,
            enum: ["pending", "billed", "void"],
            default: "pending"
        },

        // Link to the separate estimate created for these fees
        billed_in_estimate: { type: mongoose.Schema.Types.ObjectId, ref: "Estimate" },
        billed_at: { type: Date }
    },
    { timestamps: true }
);

// Prevent duplicate fees for the same invoice on the same day
lateFeeSchema.index({ original_invoice: 1, date: 1 }, { unique: true });

const LateFee = mongoose.model("LateFee", lateFeeSchema);
export default LateFee;
