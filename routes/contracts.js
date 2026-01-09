import express from "express";
import {
  getContracts,
  getContractById,
  getContractDetailed,
  sendForSignature,
  checkSignatureStatus,
  handleZohoSignWebhook,
  uploadSignedContract,
  uploadAndSendForSignature,
  generateContractPDF,
  createContract,
  deleteContract,
  updateContract,
  submitContract,
  approveContract,
  rejectContract,
  getPendingApprovalContracts,
  updateSecurityDeposit,
  addComment,
  getSectionComments,
  getDefaultTermsAndConditions,
  setWorkflowMode
} from "../controllers/contractController.js";
import { uploadStampPaper } from "../middlewares/uploadMiddleware.js";
import {
  submitToLegal,
  submitToAdmin,
  adminApprove,
  adminReject,
  sendToClient,
  markClientApproved,
  recordClientFeedback,
  generateStampPaper,
  sendForESignature,
  markSigned,
  getContractsByStatus
} from "../controllers/contractWorkflowController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import multer from "multer";

const router = express.Router();

// Configure memory storage for ImageKit upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Get all contracts
router.get("/", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_READ), getContracts);

// Get default Terms & Conditions for prefilling (auth only)
router.get("/defaults/terms-and-conditions", authMiddleware, getDefaultTermsAndConditions);

// Get contracts pending approval (for approvers)
router.get("/pending-approval", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_APPROVE), getPendingApprovalContracts);

// Create a contract - allow all authenticated users (backend will handle approval logic)
router.post("/", authMiddleware, populateUserRole, createContract);

// Get detailed contract by ID (fully populated, comment filtered)
router.get(
  "/:id/detailed",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_READ),
  getContractDetailed
);

// Get contract by ID
router.get("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_READ), getContractById);

// Update a contract
router.put("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_UPDATE), updateContract);

// Delete a contract
router.delete("/:id", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_DELETE), deleteContract);

// Submit contract for approval (or auto-approve if user has permission)
router.post("/:id/submit", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SUBMIT), submitContract);

// Approve contract (requires contract:approve permission)
router.post("/:id/approve", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_APPROVE), approveContract);

// Reject contract (requires contract:approve permission)
router.post("/:id/reject", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_APPROVE), rejectContract);

// Send contract for digital signature (requires contract:approve or contract:send_signature permission)
router.post("/:id/send-for-signature", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SEND_SIGNATURE), sendForSignature);

// Check signature status (admin only)
router.get("/:id/signature-status", authMiddleware, checkSignatureStatus);

// Generate and download contract PDF
router.get("/:id/download-pdf", generateContractPDF);

// Upload contract PDF and send for signature via Zoho Sign
router.post("/:id/upload-and-send", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SEND_SIGNATURE), upload.any(), uploadAndSendForSignature);
// Accepts multipart/form-data with any file field (e.g., 'file', 'document') or a form field 'fileUrl'
router.post("/:id/upload-signed", authMiddleware, upload.any(), uploadSignedContract);

// Debug endpoint to test Zoho token refresh
router.get("/debug/zoho-token", authMiddleware, async (req, res) => {
  try {
    const { getAccessToken } = await import("../utils/zohoSignAuth.js");
    const token = await getAccessToken();
    res.json({ success: true, tokenLength: token?.length || 0 });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      envVars: {
        hasRefreshToken: !!process.env.ZOHO_REFRESH_TOKEN,
        hasClientId: !!process.env.ZOHO_CLIENT_ID,
        hasClientSecret: !!process.env.ZOHO_CLIENT_SECRET,
        zohoDC: process.env.ZOHO_DC || 'accounts.zoho.com'
      }
    });
  }
});

// Webhook endpoint for Zoho Sign events (no auth required for webhooks)
router.post(
  "/webhook/zoho-sign",
  express.raw({ type: "application/json" }),
  handleZohoSignWebhook
);

// ===== NEW WORKFLOW ROUTES =====

// Get contracts by status (for dashboard filtering)
router.get("/status/:status", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_READ), getContractsByStatus);

// Submit to Legal (Sales → Legal)
router.post("/:id/submit-to-legal", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SUBMIT), submitToLegal);

// Submit to Admin (Legal → Admin)
router.post("/:id/submit-to-admin", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SUBMIT), submitToAdmin);

// Admin approve contract
router.post("/:id/admin-approve", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_APPROVE), adminApprove);

// Admin reject contract
router.post("/:id/admin-reject", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_REJECT), adminReject);

// Send to client for review (Legal → Client)
router.post("/:id/send-to-client", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SEND_TO_CLIENT), sendToClient);

// Mark client as approved
router.post("/:id/mark-client-approved", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_MARK_CLIENT_APPROVED), markClientApproved);

// Record client feedback (with file attachments)
router.post("/:id/client-feedback", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_UPDATE), upload.array('files', 10), recordClientFeedback);

// Generate stamp paper version
router.post("/:id/generate-stamp-paper", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_GENERATE_STAMP_PAPER), uploadStampPaper, generateStampPaper);

// Send for e-signature (Zoho Sign)
router.post("/:id/send-for-esignature", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_SEND_SIGNATURE), sendForESignature);

// Mark contract as signed
router.post("/:id/mark-signed", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_UPDATE), markSigned);

// Add comment to contract (general or section-specific)
router.post("/:id/comments", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_READ), addComment);

// Get comments for a specific terms section
router.get("/:id/sections/:section/comments", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_READ), getSectionComments);

// Update security deposit
router.post("/:id/security-deposit", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CONTRACT_UPDATE), updateSecurityDeposit);

router.put(
  "/:id/workflow-mode",
  authMiddleware,
  populateUserRole,
  requirePermission(PERMISSIONS.CONTRACT_LEGAL_APPROVE),
  setWorkflowMode
);

export default router;
