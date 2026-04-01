import express from "express";
import { getAppConfig, updateAppConfig } from "../controllers/appConfigController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { requireSystemAdmin } from "../middlewares/rbacMiddleware.js";

const router = express.Router();

/**
 * @route GET /api/app-config
 * @desc Get global app configuration
 * @access Public
 */
router.get("/", getAppConfig);

/**
 * @route PATCH /api/app-config
 * @desc Update global app configuration
 * @access Private (Admin only)
 */
router.patch("/", authMiddleware, requireSystemAdmin, updateAppConfig);

export default router;
