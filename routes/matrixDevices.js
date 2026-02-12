import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  createMatrixDevice,
  listMatrixDevices,
  getMatrixDeviceById,
  updateMatrixDevice,
  deleteMatrixDevice,

  getAvailableDevices,
} from "../controllers/matrixDeviceController.js";

const router = express.Router();

router.get("/", authMiddleware, populateUserRole, listMatrixDevices);
router.get("/available", getAvailableDevices);
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createMatrixDevice);
router.get("/:id", authMiddleware, populateUserRole, getMatrixDeviceById);
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateMatrixDevice);
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteMatrixDevice);

export default router;
