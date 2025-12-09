import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole } from "../middlewares/rbacMiddleware.js";
import { ingestMatrixEvents, listAccessEvents } from "../controllers/accessEventController.js";

const router = express.Router();

// Vendor webhook ingestion (Matrix)
router.post("/vendor/matrix", ingestMatrixEvents);

// Admin listing
router.get("/", authMiddleware, populateUserRole, listAccessEvents);

export default router;
