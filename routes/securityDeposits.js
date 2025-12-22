import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createDeposit,
  getDepositById,
  markDepositDue,
  adjustDeposit,
  refundDeposit,
  forfeitDeposit,
  closeDeposit,
} from "../controllers/securityDepositController.js";

const router = express.Router();

// Create a new security deposit record
router.post(
  "/",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_CREATE),
  createDeposit
);

// Get a security deposit by ID
router.get(
  "/:id",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_READ),
  getDepositById
);

// Mark deposit as due (creates a non-GST invoice and links it)
router.post(
  "/:id/mark-due",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_CREATE),
  markDepositDue
);

// Adjust amount from deposit
router.post(
  "/:id/adjust",
  authMiddleware,
  checkPermission(PERMISSIONS.PAYMENT_UPDATE),
  adjustDeposit
);

// Refund amount from deposit
router.post(
  "/:id/refund",
  authMiddleware,
  checkPermission(PERMISSIONS.PAYMENT_REFUND),
  refundDeposit
);

// Forfeit amount from deposit
router.post(
  "/:id/forfeit",
  authMiddleware,
  checkPermission(PERMISSIONS.PAYMENT_UPDATE),
  forfeitDeposit
);

// Close deposit
router.post(
  "/:id/close",
  authMiddleware,
  checkPermission(PERMISSIONS.PAYMENT_UPDATE),
  closeDeposit
);

export default router;
