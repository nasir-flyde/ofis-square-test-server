import express from "express";
import multer from "multer";
import {
  uploadKYCDocuments,
  approveKYC,
  legalApprove,
  setAdminApproval,
  setClientApproval,
  uploadStampPaper,
  recordSecurityDeposit,
  markClientSigned,
  getContractsByWorkflowStage,
  getWorkflowStatus
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

// KYC Approve (after upload)
router.post("/:id/kyc/approve",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_UPDATE),
  approveKYC
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

export default router;
