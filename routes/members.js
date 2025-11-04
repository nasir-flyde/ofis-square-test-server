import express from "express";
<<<<<<< Updated upstream
import authVerify from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
=======
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
>>>>>>> Stashed changes
import {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember
} from "../controllers/memberController.js";

const router = express.Router();

<<<<<<< Updated upstream
// Create member (admin only)
router.post("/", authVerify, checkPermission("admin"), createMember);

// Get all members with filters
router.get("/", authVerify, getMembers);

// Get member by ID
router.get("/:id", authVerify, getMemberById);

// Update member (admin only)
router.put("/:id", authVerify, checkPermission("admin"), updateMember);

// Delete member (admin only)
router.delete("/:id", authVerify, checkPermission("admin"), deleteMember);
=======
// Create member - requires member:create permission
router.post("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_CREATE), createMember);

// Get all members - requires member:read permission
router.get("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_READ), getMembers);

// Get own profile from JWT (no special permission needed, just authentication)
router.get("/profile", universalAuthMiddleware, getMemberProfile);

// Get member by ID - requires member:read permission
router.get("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_READ), getMemberById);

// Get specific member profile - requires member:read permission
router.get("/:id/profile", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_READ), getMemberProfile);

// Update member - requires member:update permission
router.put("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_UPDATE), updateMember);

// Delete member - requires member:delete permission
router.delete("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_DELETE), deleteMember);
>>>>>>> Stashed changes

export default router;
