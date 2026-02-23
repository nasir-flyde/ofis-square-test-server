import express from 'express';
import {
    createManualNotification,
    getNotifications,
    getNotificationById,
    updateNotificationStatus,
    deleteNotification,
    getNotificationsByMember,
    markNotificationAsRead,
    getNotificationsByCategory
} from '../controllers/appNotificationsController.js';
import upload from '../middlewares/multer.js';
import authMiddleware from '../middlewares/authVerify.js';

const router = express.Router();

// Define notificationUploads locally or use the general upload.fields
const notificationUploads = upload.fields([{ name: 'image', maxCount: 1 }]);

// Route to get notifications by category
router.get('/category/:categoryId', getNotificationsByCategory);
router.get('/member/:memberId', getNotificationsByMember);

// Create manual notification with optional image upload
router.post('/manual', notificationUploads, createManualNotification);

// Get all notifications with filtering and pagination
router.get('/all', getNotifications);

// Get notification by ID
router.get('/:id', getNotificationById);

// Mark a notification as read
router.post('/:id/read', authMiddleware, markNotificationAsRead);

// Update notification status
router.patch('/:id/status', updateNotificationStatus);

// Delete notification
router.delete('/:id', deleteNotification);

export default router;
