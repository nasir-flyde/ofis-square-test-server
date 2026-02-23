import mongoose from "mongoose";

const tourBookingSchema = new mongoose.Schema({
    lead: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true
    },
    slot: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TourSlot',
        required: true
    },
    status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

const TourBooking = mongoose.model("TourBooking", tourBookingSchema);

export default TourBooking;
