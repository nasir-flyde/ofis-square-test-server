import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { getDashboardSummary } from "../controllers/dashboardController.js";

const router = express.Router();

// GET /api/dashboard - consolidated dashboard data
router.get("/", authMiddleware, checkPermission(PERMISSIONS.REPORT_READ), getDashboardSummary);

export default router;
