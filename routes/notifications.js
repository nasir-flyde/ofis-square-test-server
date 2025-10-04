import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import {
  createNotification,
  getNotifications,
  getNotificationById,
  markAsRead,
  retryNotification,
  //cancelNotification,
  getNotificationStats,
  getMemberNotifications,
  getCommunityNotifications,
  getMemberOnlyNotifications
} from "../controllers/notificationController.js";

const router = express.Router();

router.post("/", universalAuthMiddleware, createNotification);
router.get("/", authMiddleware, getNotifications);
router.get("/stats", authMiddleware, getNotificationStats);
router.get("/member", universalAuthMiddleware, getMemberNotifications);
router.get("/member-only", universalAuthMiddleware, getMemberOnlyNotifications);
router.get("/community", universalAuthMiddleware, getCommunityNotifications);
router.get("/:id", authMiddleware, getNotificationById);
router.post("/:id/mark-read", authMiddleware, markAsRead);
router.post("/:id/retry", authMiddleware, retryNotification);
// router.post("/:id/cancel", authMiddleware, cancelNotification);

export default router;
