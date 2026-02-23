import mongoose from 'mongoose';

const appNotificationCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    }
}, {
    timestamps: true
});

export default mongoose.model('AppNotificationCategory', appNotificationCategorySchema);
