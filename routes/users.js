import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission, requireAnyPermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  getUsers,
  getStaffUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getInternalUsers,
  createClientLegalUser,
  verifyCreateUserOTP,
  verifyDeleteUserOTP
} from "../controllers/userController.js";

const router = express.Router();

router.get("/", authMiddleware, getUsers);
router.get("/internal", authMiddleware, getInternalUsers);
router.get("/staff", getStaffUsers);
router.get("/:id", getUserById);
router.post("/", authMiddleware, createUser);
router.post("/verify-create", authMiddleware, verifyCreateUserOTP);
router.post("/verify-delete", authMiddleware, verifyDeleteUserOTP);
router.put("/:id", updateUser);
router.delete("/:id", authMiddleware, deleteUser);

// Create Client Legal Team user (admin-only)
router.post(
  "/client-legal",
  authMiddleware,
  populateUserRole,
  requireAnyPermission([PERMISSIONS.USER_CREATE, PERMISSIONS.CONTRACT_SALES_CREATE]),
  createClientLegalUser
);

export default router;
