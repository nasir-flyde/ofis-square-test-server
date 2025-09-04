import express from "express";
import authRoutes from "./auth.js";
import roleRoutes from "./roles.js";
import healthRoutes from "./health.js";
import clientRoutes from "./clients.js";
import contractRoutes from "./contracts.js";

const router = express.Router();

// Modular routes (mirroring ezstays-backend style)
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/roles", roleRoutes);
router.use("/clients", clientRoutes);
router.use("/contracts", contractRoutes);

export default router;
