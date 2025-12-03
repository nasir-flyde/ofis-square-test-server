import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  createMatrixDevice,
  listMatrixDevices,
  getMatrixDeviceById,
  updateMatrixDevice,
  deleteMatrixDevice,
} from "../controllers/matrixDeviceController.js";

const router = express.Router();

// List devices
router.get("/", authMiddleware, populateUserRole, listMatrixDevices);

// Create device (restricted)
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createMatrixDevice);

// Get by id
router.get("/:id", authMiddleware, populateUserRole, getMatrixDeviceById);

// Update (restricted)
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateMatrixDevice);

// Delete (restricted)
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteMatrixDevice);

export default router;
