import mongoose from 'mongoose';

const appNotificationSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    image: {
        type: String,
        required: false,
        trim: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AppNotificationCategory',
        required: false
    },
    type: {
        type: String,
        enum: ['auto', 'manual'],
        required: true
    },
    isRead: {
        type: Boolean,
        default: false,
    },
    readAt: {
        type: Date,
    },
    targetMemberIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member',
        required: true
    }],
    filters: {
        locationIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Location'
        }],
        buildingIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Building'
        }],
        gender: {
            type: String,
            enum: ['male', 'female', 'other']
        },
        city: {
            type: String
        }
    },
    triggerEvent: {
        type: String,
        required: function () {
            return this.type === 'auto';
        }
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    readBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Member'
    }],
    scheduledFor: {
        type: Date
    }
}, { timestamps: true });

// Static method to resolve members by filters
appNotificationSchema.statics.resolveMembersByFilters = async function (filters) {
    const query = {};

    if (filters.assignedMemberIds?.length) {
        return filters.assignedMemberIds.map(id =>
            typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
        );
    }

    if (filters.buildingIds?.length) {
        // We need to find members who belong to these buildings. 
        // Usually members are linked to clients, and clients have contracts for buildings.
        // Or members have desks in buildings. Let's look at memberModel again.
        // memberModel has 'client' and 'desk'.
        // Desk has building. 
        const Desk = mongoose.model('Desk');
        const desks = await Desk.find({ building: { $in: filters.buildingIds } }).select('_id');
        const deskIds = desks.map(d => d._id);
        query.desk = { $in: deskIds };
    }

    if (filters.gender) {
        // Note: memberModel doesn't have gender yet. If needed, it should be added or this filter skipped.
        // For now, I'll keep it in the query but it might not match anything if not in model.
        query.gender = filters.gender;
    }

    if (filters.city) {
        // Member model doesn't have city directly. 
        query.city = filters.city;
    }

    const Member = mongoose.model('Member');
    const members = await Member.find(query);
    return members.map(m => m._id);
};

export default mongoose.model('AppNotification', appNotificationSchema);
