import AppNotification from '../models/appNotificationModel.js';
import Member from '../models/memberModel.js';
import AppNotificationCategory from '../models/appNotificationCategoryModel.js';
import mongoose from 'mongoose';
import admin from '../utils/firebase.js';
import imagekit from '../utils/imageKit.js';
import { sendNotification } from '../utils/notificationHelper.js';

export const createManualNotification = async (req, res) => {
    try {
        const { title, message, filters, scheduledFor, assignedMemberId, category } = req.body;

        if (!title || !message) {
            return res.status(400).json({
                message: 'Title and message are required fields'
            });
        }

        let imageUrl = null;

        if (req.files && req.files.image && req.files.image[0]) {
            try {
                const imageFile = req.files.image[0];
                const uploadResponse = await imagekit.upload({
                    file: imageFile.buffer,
                    fileName: `app_notification_${Date.now()}_${imageFile.originalname}`,
                    folder: '/app_notifications'
                });
                imageUrl = uploadResponse.url;
            } catch (uploadError) {
                console.error('Image upload error:', uploadError);
                return res.status(400).json({
                    message: 'Error uploading image',
                    error: uploadError.message
                });
            }
        }

        let notification;

        if (assignedMemberId) {
            if (!mongoose.Types.ObjectId.isValid(assignedMemberId)) {
                return res.status(400).json({ message: 'Invalid member ID' });
            }

            const member = await Member.findById(assignedMemberId);
            if (!member) {
                return res.status(404).json({ message: 'Member not found' });
            }

            notification = new AppNotification({
                title,
                message,
                image: imageUrl,
                type: 'manual',
                targetMemberIds: [assignedMemberId],
                category,
                createdBy: req.user?._id,
            });

            await notification.save();

            if (scheduledFor) {
                notification.scheduledFor = new Date(scheduledFor);
                await notification.save();
                return res.status(201).json(notification);
            }

            // Send push notification
            await sendPushNotification({ memberId: assignedMemberId }, notification);

        } else {
            const targetMemberIds = await AppNotification.resolveMembersByFilters(filters || {});

            notification = new AppNotification({
                title,
                message,
                image: imageUrl,
                category,
                type: 'manual',
                targetMemberIds,
                filters,
                createdBy: req.user?._id
            });

            await notification.save();

            if (scheduledFor) {
                notification.scheduledFor = new Date(scheduledFor);
                await notification.save();
                return res.status(201).json(notification);
            }

            // Send push notifications
            for (const memberId of notification.targetMemberIds) {
                await sendPushNotification({ memberId: memberId }, notification);
            }
        }

        res.status(201).json(notification);
    } catch (error) {
        console.error('Create app notification error:', error);
        res.status(500).json({
            message: 'Error creating app notification',
            error: error.message
        });
    }
};

export const sendPushNotification = async (target, notification) => {
    try {
        let member = null;
        let fcmTokens = [];

        if (target.memberId) {
            member = await Member.findById(target.memberId).select('fcmTokens firstName lastName');
            if (member) {
                fcmTokens = member.fcmTokens || [];
            }
        }

        const validTokens = fcmTokens.filter(token => token && typeof token === 'string');

        if (validTokens.length === 0) {
            return;
        }

        const message = {
            notification: {
                title: notification.title,
                body: notification.message,
            },
            data: {
                notificationId: notification._id.toString(),
            },
        };

        for (const token of validTokens) {
            try {
                if (admin.apps.length > 0) {
                    await admin.messaging().send({ ...message, token });
                    console.log(`[sendPushNotification] Push sent to token: ${token}`);
                }
            } catch (error) {
                console.error(`[sendPushNotification] Failed to send to token ${token}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[sendPushNotification] Error:', error.message);
    }
};

export const getNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 10, type, member, createdBy } = req.query;

        const filter = {};
        if (type && ['auto', 'manual'].includes(type)) {
            filter.type = type;
        }
        if (member && mongoose.Types.ObjectId.isValid(member)) {
            filter.targetMemberIds = member;
        }
        if (createdBy && mongoose.Types.ObjectId.isValid(createdBy)) {
            filter.createdBy = createdBy;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const notifications = await AppNotification.find(filter)
            .populate('createdBy', 'name email')
            .populate('category', 'name description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await AppNotification.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

export const getNotificationById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid notification ID' });
        }

        const notification = await AppNotification.findById(id)
            .populate('createdBy', 'name email')
            .populate('category', 'name description');

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const updateNotificationStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid notification ID' });
        }

        const notification = await AppNotification.findByIdAndUpdate(
            id,
            { isActive },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid notification ID' });
        }

        const notification = await AppNotification.findByIdAndDelete(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const getNotificationsByMember = async (req, res) => {
    try {
        const { memberId } = req.params;
        const { page = 1, limit = 10 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(memberId)) {
            return res.status(400).json({ success: false, message: 'Invalid member ID' });
        }

        const filter = { targetMemberIds: memberId, isActive: true };
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const notifications = await AppNotification.find(filter)
            .populate('createdBy', 'name email')
            .populate('category', 'name description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await AppNotification.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};

export const markNotificationAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const memberId = req.user?.memberId;

        if (!memberId) {
            return res.status(401).json({ success: false, message: 'Member authentication required' });
        }

        const notification = await AppNotification.findById(id);

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        if (!notification.readBy.includes(memberId)) {
            notification.readBy.push(memberId);
            await notification.save();
        }

        res.status(200).json({ success: true, message: 'Notification marked as read', data: notification });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
    }
};

export const getNotificationsByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { page = 1, limit = 10 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            return res.status(400).json({ success: false, message: 'Invalid category ID' });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const notifications = await AppNotification.find({ category: categoryId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate('category', 'name description');

        const total = await AppNotification.countDocuments({ category: categoryId });

        res.status(200).json({
            success: true,
            data: notifications,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
};
