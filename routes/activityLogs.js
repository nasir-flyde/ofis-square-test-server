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
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";

const router = express.Router();

// Admin-only routes (viewing/managing logs)
router.get("/", authMiddleware, populateUserRole, requireSystemAdmin, getAllActivityLogs);
router.get("/stats", authMiddleware, populateUserRole, requireSystemAdmin, getActivityStats);
router.get("/export", authMiddleware, populateUserRole, requireSystemAdmin, exportActivityLogs);
router.get("/:id", authMiddleware, populateUserRole, requireSystemAdmin, getActivityLogById);
router.get("/user/:userId", authMiddleware, populateUserRole, requireSystemAdmin, getUserActivityLogs);
router.get("/entity/:entity/:entityId", authMiddleware, populateUserRole, requireSystemAdmin, getEntityActivityLogs);
router.post("/", universalAuthMiddleware, createActivityLog);
router.delete("/cleanup", authMiddleware, populateUserRole, requireSystemAdmin, cleanupActivityLogs);

export default router;
