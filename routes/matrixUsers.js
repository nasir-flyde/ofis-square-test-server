import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  createMatrixUser,
  listMatrixUsers,
  getMatrixUserById,
  updateMatrixUser,
  deleteMatrixUser,
  addCardRef,
  addEnrollment,
  setCardCredentialVerified,
  setValidity,
  addAccessHistory,
  assignToDevice,
  enrollCardToDevice,
} from "../controllers/matrixUserController.js";

const router = express.Router();

// List users
router.get("/", authMiddleware, populateUserRole, listMatrixUsers);

// Create user (restricted)
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createMatrixUser);

// Get by id
router.get("/:id", authMiddleware, populateUserRole, getMatrixUserById);

// Update (restricted)
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateMatrixUser);

// Delete (restricted)
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteMatrixUser);

// Add a card reference to user (restricted)
router.post("/:id/cards", authMiddleware, populateUserRole, requireSystemAdmin, addCardRef);

// Add enrollment to user (restricted)
router.post("/:id/enrollments", authMiddleware, populateUserRole, requireSystemAdmin, addEnrollment);

// Set card credential verified flag (restricted)
router.post("/:id/card-verified", authMiddleware, populateUserRole, requireSystemAdmin, setCardCredentialVerified);

// Set valid till date (restricted)
router.post("/:id/validity", authMiddleware, populateUserRole, requireSystemAdmin, setValidity);

// Add access/revoke history entry (restricted)
router.post("/:id/access-history", authMiddleware, populateUserRole, requireSystemAdmin, addAccessHistory);

// Assign to device (restricted)
router.post(
  "/:id/assign-device",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  assignToDevice
);

// Enroll card via policy and selected enrollment detail (restricted)
router.post(
  "/:id/enroll-card",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  enrollCardToDevice
);

export default router;
