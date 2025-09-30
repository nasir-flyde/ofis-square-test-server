import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  createNotification,
  getNotifications,
  getNotificationById,
  markAsRead,
  retryNotification,
  cancelNotification,
  getNotificationStats
} from "../controllers/notificationController.js";

const router = express.Router();


router.post("/", authMiddleware, createNotification);
router.get("/", authMiddleware, getNotifications);
router.get("/stats", authMiddleware, getNotificationStats);
router.get("/:id", authMiddleware, getNotificationById);
router.post("/:id/mark-read", authMiddleware, markAsRead);
router.post("/:id/retry", authMiddleware, retryNotification);
router.post("/:id/cancel", authMiddleware, cancelNotification);

export default router;
