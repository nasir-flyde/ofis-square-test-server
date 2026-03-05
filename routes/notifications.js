import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import upload from '../middlewares/multer.js';
import { stopEmailService, startEmailService, getEmailServiceStatus } from "../utils/emailService.js";
import {
  createNotification,
  getNotifications,
  getNotificationById,
  markAsRead,
  retryNotification,
  getNotificationStats,
  getMemberNotifications,
  getCommunityNotifications,
  getMemberOnlyNotifications,
  getNotificationsByCategory,
  getNotificationsByMemberId,
  updateNotificationStatus,
  deleteNotification
} from "../controllers/notificationController.js";

const router = express.Router();
const notificationUploads = upload.fields([{ name: 'image', maxCount: 1 }]);

// Standard routes
router.get("/", authMiddleware, getNotifications);
router.get("/all", authMiddleware, getNotifications);
router.get("/stats", authMiddleware, getNotificationStats);
router.get("/community", universalAuthMiddleware, getCommunityNotifications);

// Recipient/Category specific
router.get("/member", universalAuthMiddleware, getMemberNotifications);
router.get("/member-only", universalAuthMiddleware, getMemberOnlyNotifications);
router.get("/member/:memberId", authMiddleware, getNotificationsByMemberId);
router.get("/category/:categoryId", authMiddleware, getNotificationsByCategory);

// Creation
router.post("/", universalAuthMiddleware, createNotification);
router.post("/manual", authMiddleware, notificationUploads, createNotification);

// Item specific
router.get("/:id", authMiddleware, getNotificationById);
router.post("/:id/mark-read", authMiddleware, markAsRead);
router.post("/:id/read", authMiddleware, markAsRead); // Alias
router.post("/:id/retry", authMiddleware, retryNotification);
router.patch("/:id/status", authMiddleware, updateNotificationStatus);
router.delete("/:id", authMiddleware, deleteNotification);

// Email service control routes
router.post("/email-service/stop", async (req, res) => {
  const success = await stopEmailService();
  if (success) {
    res.json({ success: true, message: "Email service stopped successfully." });
  } else {
    res.status(500).json({ success: false, message: "Failed to stop email service." });
  }
});

router.post("/email-service/start", async (req, res) => {
  const success = await startEmailService();
  if (success) {
    res.json({ success: true, message: "Email service started successfully." });
  } else {
    res.status(500).json({ success: false, message: "Failed to start email service." });
  }
});

router.get("/email-service/status", async (req, res) => {
  const isActive = await getEmailServiceStatus();
  res.json({ success: true, isActive });
});

export default router;
