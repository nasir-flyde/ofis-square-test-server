import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import ctrl from "../controllers/memberIntegrationsController.js";

const router = express.Router();

// MATRIX integrations
router.post(
  "/:id/matrix/create",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.createMatrixUserForMember
);

router.post(
  "/:id/matrix/assign-device",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.assignMatrixDeviceForMember
);

router.post(
  "/:id/matrix/enroll-card",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.enrollCardToMatrixDevicesForMember
);

router.post(
  "/:id/matrix/card/credential",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.setMatrixCardCredentialForMember
);

router.post(
  "/:id/matrix/card/verified",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.setMatrixCardVerifiedForMember
);

router.post(
  "/:id/matrix/validity",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.setMatrixValidityForMember
);

router.get(
  "/:id/matrix/policy-devices",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  ctrl.listMatrixPolicyDevicesForMember
);

router.post(
  "/:id/matrix/revoke-device",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.revokeMatrixFromDeviceForMember
);

router.get(
  "/:id/matrix/card-devices",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  ctrl.listMatrixCardDevicesForMember
);

// BHAIFI integrations
router.post(
  "/:id/bhaifi/create",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.createBhaifiForMember
);

router.post(
  "/:id/bhaifi/whitelist",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.whitelistBhaifiForMember
);

router.post(
  "/:id/bhaifi/dewhitelist",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  ctrl.dewhitelistBhaifiForMember
);

router.get(
  "/:id/bhaifi",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  ctrl.listBhaifiForMember
);

router.get(
  "/:id/bhaifi/:bhaifiId",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.MEMBER_READ),
  ctrl.getBhaifiForMember
);

export default router;
