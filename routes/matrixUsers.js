import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin, requireAnyPermission } from "../middlewares/rbacMiddleware.js";
import {
  findByPhone,
  createMatrixUser,
  listMatrixUsers,
  getMatrixUserById,
  updateMatrixUser,
  deleteMatrixUser,
  addCardRef,
  // addEnrollment,
  setCardCredentialVerified,
  setValidity,
  // addAccessHistory,
  assignToDevice,
  // enrollCardToDevice,
  setCardCredential,
  listPolicyDevices,
  revokeFromDevice,
  listCardDevices,
} from "../controllers/matrixUserController.js";

const router = express.Router();

router.get("/find-by-phone", authMiddleware, populateUserRole, findByPhone);
router.get("/", authMiddleware, populateUserRole, listMatrixUsers);
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createMatrixUser);
router.get("/:id", authMiddleware, populateUserRole, getMatrixUserById);
router.put("/:id", authMiddleware, populateUserRole, requireSystemAdmin, updateMatrixUser);
router.delete("/:id", authMiddleware, populateUserRole, requireSystemAdmin, deleteMatrixUser);
router.post("/:id/cards", authMiddleware, populateUserRole, requireSystemAdmin, addCardRef);
// router.post("/:id/enrollments", authMiddleware, populateUserRole, requireSystemAdmin, addEnrollment);
router.post("/:id/card-verified", authMiddleware, populateUserRole, requireSystemAdmin, setCardCredentialVerified);
router.post("/:id/validity", authMiddleware, populateUserRole, requireSystemAdmin, setValidity);
// router.post("/:id/access-history", authMiddleware, populateUserRole, requireSystemAdmin, addAccessHistory);
router.post(
  "/:id/assign-device",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  assignToDevice
);
// router.post(
//   "/:id/enroll-card",
//   authMiddleware,
//   populateUserRole,
//   requireSystemAdmin,
//   enrollCardToDevice
// );
router.post(
  "/:id/set-card-credential",
  authMiddleware,
  populateUserRole,
  requireAnyPermission(["*:*", "rfid:assign:member"]),
  setCardCredential
);

// List policy devices to operate against (restricted)
router.get(
  "/:id/policy-devices",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  listPolicyDevices
);

// Revoke access from a specific device (restricted)
router.post(
  "/:id/revoke-device",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  revokeFromDevice
);

// List devices derived from user's RFID cards (restricted)
router.get(
  "/:id/card-devices",
  authMiddleware,
  populateUserRole,
  requireSystemAdmin,
  listCardDevices
);

export default router;
