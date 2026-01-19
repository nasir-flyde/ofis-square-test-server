import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole } from "../middlewares/rbacMiddleware.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createBhaifiUser,
  listBhaifiUsers,
  getBhaifiUser,
  whitelistBhaifiUser,
  dewhitelistBhaifiUser,
  grantEnterpriseAccess,
  listNasByBuilding,
  createNasForBuilding,
} from "../controllers/bhaifiController.js";

const router = express.Router();

// List users
router.get(
  "/users",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  listBhaifiUsers
);
// List users
// router.get(
//   "/users",
//   listBhaifiUsers
// );


// Create user for a member
router.post(
  "/users",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  createBhaifiUser
);

// Get user by local id
router.get(
  "/users/:id",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  getBhaifiUser
);

// Manual whitelist for a Bhaifi user (uses contract endDate by default)
router.post(
  "/users/:id/whitelist",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  whitelistBhaifiUser
);

// Record a dewhitelist action for a Bhaifi user
router.post(
  "/users/:id/dewhitelist",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  dewhitelistBhaifiUser
);

router.post(
  "/buildings/:buildingId/enterprise/access",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  grantEnterpriseAccess
);

// List NAS devices configured for a building
router.get(
  "/buildings/:buildingId/nas",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  listNasByBuilding
);

// Create NAS mapping for a building
router.post(
  "/buildings/:buildingId/nas",
  authMiddleware,
  populateUserRole,
  checkPermission(PERMISSIONS.MEMBER_MANAGE_ACCESS),
  createNasForBuilding
);

export default router;
