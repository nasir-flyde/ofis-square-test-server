import express from "express";
import multer from "multer";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createBySales,
  salesSeniorUpdateAndApprove,
  legalUploadDocument,
  adminApproveCustom,
  sendToClientForSignature,
  clientFeedbackAction,
  clientApproveAndSign,
  getWorkflowStatus,
} from "../controllers/contractCustomController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Sales creates a contract (status: pushed)
router.post(
  "/create-by-sales",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_SALES_CREATE),
  createBySales
);

// Sales Senior updates and approves
router.put(
  "/:id/senior/update-and-approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_SALES_SENIOR_APPROVE),
  salesSeniorUpdateAndApprove
);

// Legal uploads final contract document (uses existing fileUrl)
router.post(
  "/:id/legal/upload",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_LEGAL_UPLOAD),
  upload.single("file"),
  legalUploadDocument
);

// System Admin approves
router.post(
  "/:id/admin/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_ADMIN_APPROVE),
  adminApproveCustom
);

// Send to client for signature (Zoho eSign)
router.post(
  "/:id/send-to-client",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_SEND_FOR_SIGNATURE),
  sendToClientForSignature
);

// Client feedback (manual entry endpoint)
router.post(
  "/:id/client/feedback",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  clientFeedbackAction
);

// Client approves/signs (manual endpoint; in prod use webhook)
router.post(
  "/:id/client/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_CLIENT_APPROVE),
  clientApproveAndSign
);

// Workflow status for custom flow
router.get(
  "/:id/workflow/status",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_READ),
  getWorkflowStatus
);

export default router;
