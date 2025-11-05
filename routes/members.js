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
  getMemberProfile
} from "../controllers/memberController.js";

const router = express.Router();


router.post("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_CREATE), createMember);
router.get("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_READ), getMembers);
router.get("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_READ), getMemberById);
router.put("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_UPDATE), updateMember);
router.delete("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_DELETE), deleteMember);
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

router.post("/", createMember);
router.get("/",getMembers);
router.get("/profile", universalAuthMiddleware, getMemberProfile); // Get own profile from JWT
router.get("/:id", authMiddleware, getMemberById);
router.get("/:id/profile", authMiddleware, getMemberProfile); // Get specific member profile
router.put("/:id", authMiddleware, updateMember);
router.delete("/:id", authMiddleware, deleteMember);

export default router;
