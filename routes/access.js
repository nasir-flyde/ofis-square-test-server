import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  grantAccess,
  revokeAccess,
  suspendGrant,
  resumeGrant,
  extendGrant,
  listAccessGrants,
  generateQR,
  validateQR,
  listAccessPolicies,
  createAccessPolicy,
  updateAccessPolicy,
} from "../controllers/accessController.js";

const router = express.Router();

router.post("/grant", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), grantAccess);
router.post("/revoke", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), revokeAccess);
router.patch("/suspend", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), suspendGrant);
router.patch("/resume", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), resumeGrant);
router.patch("/extend", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), extendGrant);
router.get("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS), listAccessGrants);
router.post("/qr/generate", universalAuthMiddleware, generateQR);
router.post("/qr/validate", universalAuthMiddleware, validateQR);

// Policies listing for admin UI
router.get(
  "/policies",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  listAccessPolicies
);

// Create policy
router.post(
  "/policies",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  createAccessPolicy
);

// Update policy (can derive accessPointIds from a Cabin's matrixDevices by sending cabinId)
router.patch(
  "/policies/:id",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  updateAccessPolicy
);

export default router;
