import mongoose from "mongoose";

const tourSlotSchema = new mongoose.Schema({
    city: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'City',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    timeSlot: {
        type: String,
        required: true,
        trim: true
    },
    isAvailable: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for efficient queries by city and date
tourSlotSchema.index({ city: 1, date: 1 });

const TourSlot = mongoose.model("TourSlot", tourSlotSchema);

export default TourSlot;
