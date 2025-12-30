import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import upload from "../middlewares/multer.js";
import {
  createDeposit,
  getDepositById,
  listDeposits,
  markDepositDue,
  adjustDeposit,
  refundDeposit,
  forfeitDeposit,
  closeDeposit,
  generateDepositNote,
  uploadDepositImages,
} from "../controllers/securityDepositController.js";

const router = express.Router();

// List security deposits (filterable by client/contract/status/building)
router.get(
  "/",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_READ),
  listDeposits
);

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

// (Re)Generate Security Deposit Note as PDF and upload to ImageKit
router.post(
  "/:id/generate-note",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_CREATE),
  generateDepositNote
);

// Upload images/screenshots to Security Deposit
router.post(
  "/:id/images",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_UPDATE),
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'screenshots', maxCount: 10 }
  ]),
  uploadDepositImages
);

export default router;
