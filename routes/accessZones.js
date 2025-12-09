import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  listAccessZones,
  createAccessZone,
  getAccessZoneById,
  updateAccessZone,
  deleteAccessZone,
} from "../controllers/accessZoneController.js";

const router = express.Router();

// List zones
router.get("/", authMiddleware, populateUserRole, listAccessZones);

// Create (restricted)
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createAccessZone);

// Get by id
router.get("/:id", authMiddleware, populateUserRole, getAccessZoneById);

// Update (restricted)
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateAccessZone);

// Delete (restricted)
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteAccessZone);

export default router;
