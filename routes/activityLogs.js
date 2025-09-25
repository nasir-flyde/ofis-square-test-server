import express from "express";
import {
  getAllActivityLogs,
  getActivityLogById,
  getUserActivityLogs,
  getEntityActivityLogs,
  getActivityStats,
  exportActivityLogs,
  cleanupActivityLogs,
  createActivityLog
} from "../controllers/activityLogController.js";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";

const router = express.Router();

// Admin-only routes (viewing/managing logs)
router.get("/", authMiddleware, getAllActivityLogs);
router.get("/stats", authMiddleware, getActivityStats);
router.get("/export", authMiddleware, exportActivityLogs);
router.get("/:id", authMiddleware, getActivityLogById);
router.get("/user/:userId", authMiddleware, getUserActivityLogs);
router.get("/entity/:entity/:entityId", authMiddleware, getEntityActivityLogs);
router.post("/", universalAuthMiddleware, createActivityLog);
router.delete("/cleanup", authMiddleware, cleanupActivityLogs);

export default router;
