import express from "express";
import multer from "multer";
import {
  uploadKYCDocuments,
  approveKYC,
  uploadKYCDocumentByType,
  approveKYCDocumentByType,
  bulkUploadKYCDocumentsByType,
  bulkApproveKYCDocumentsByType,
  legalApprove,
  setAdminApproval,
  setFinanceApproval,
  setClientApproval,
  uploadStampPaper,
  recordSecurityDeposit,
  markClientSigned,
  getContractsByWorkflowStage,
  getWorkflowStatus,
  updateContractApprovalFlag,
  finalApprove
} from "../controllers/contractApprovalController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// KYC Document Upload (can be done at any stage)
router.post("/:id/kyc/upload", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  upload.array('files', 10), 
  uploadKYCDocuments
);

// Bulk KYC upload with per-document types mapping
// multipart/form-data:
//  - documents: multiple files
//  - docTypes: array or JSON string of doc types (e.g., ["panCard","addressProof"]) matching the files order
router.post("/:id/kyc/bulk/upload",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  upload.array('documents', 20),
  bulkUploadKYCDocumentsByType
);

// Per-document KYC upload (docType must be one of the schema keys)
router.post("/:id/kyc/:docType/upload",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  upload.single('file'),
  uploadKYCDocumentByType
);

// KYC Approve (after upload)
router.post("/:id/kyc/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  approveKYC
);

// Bulk approve KYC docs: body { docTypes: [..] } or { all: true }
router.post("/:id/kyc/bulk/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  bulkApproveKYCDocumentsByType
);

// Per-document KYC approve
router.post("/:id/kyc/:docType/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  approveKYCDocumentByType
);

// Legal Team Approval (First step after draft)
router.post("/:id/legal/approve", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_LEGAL_APPROVE),
  legalApprove
);

// Admin Approval (After legal approval)
router.post("/:id/admin/approve", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_ADMIN_APPROVE),
  setAdminApproval
);

// Finance Approval (After admin approval)
router.post("/:id/finance/approve", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_FINANCE_APPROVE),
  setFinanceApproval
);

// Client Approval (After admin approval)
router.post("/:id/client/approve", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  setClientApproval
);

router.post("/:id/stamp-paper/upload", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  upload.single('file'),
  uploadStampPaper
);

router.post("/:id/security-deposit", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  recordSecurityDeposit
);

router.post("/:id/client/sign",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  markClientSigned
);

// Update generic contract approval flag (for workflow steps like stamp paper)
router.post("/:id/flag/update",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  updateContractApprovalFlag
);

// Get contracts by workflow stage
router.get("/workflow/:stage", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_READ),
  getContractsByWorkflowStage
);

// Get workflow status for a contract
router.get("/:id/workflow/status", 
  authMiddleware, 
  populateUserRole, 
  requirePermission(PERMISSIONS.CONTRACT_READ),
  getWorkflowStatus
);

// Final Approval
router.post("/:id/final/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_FINAL_APPROVE),
  finalApprove
);

export default router;
