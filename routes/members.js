import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember,
  getMemberProfile,
  exportMembers,
  checkUniqueness
} from "../controllers/memberController.js";

const router = express.Router();

// Create member - requires member:create permission
router.post(
  "/",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_CREATE),
  createMember
);

router.get("/export", exportMembers);

// Get all members - requires member:read permission
router.get(
  "/",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  getMembers
);

router.get("/check-uniqueness", authMiddleware, checkUniqueness);

// Profile routes (define BEFORE parameterized routes to avoid conflicts)
// Get own profile from JWT (supports member/client auth via universal middleware)
router.get("/profile", universalAuthMiddleware, getMemberProfile);

// Get specific member profile by ID - requires member:read permission
router.get(
  "/:id/profile",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  getMemberProfile
);

// Get member by ID - requires member:read permission
router.get(
  "/:id",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  getMemberById
);

// Update member - requires member:update permission
router.put(
  "/:id",
  authMiddleware,
  updateMember
);

// Delete member - requires member:delete permission
router.delete(
  "/:id",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_DELETE),
  deleteMember
);

export default router;
