import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  listAccessPoints,
  createAccessPoint,
  getAccessPointById,
  updateAccessPoint,
  deleteAccessPoint,
} from "../controllers/accessPointController.js";

const router = express.Router();

// List access points
router.get("/", authMiddleware, populateUserRole, listAccessPoints);

// Create (restricted)
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createAccessPoint);

// Get by id
router.get("/:id", authMiddleware, populateUserRole, getAccessPointById);

// Update (restricted)
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateAccessPoint);

// Delete (restricted)
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteAccessPoint);

export default router;
