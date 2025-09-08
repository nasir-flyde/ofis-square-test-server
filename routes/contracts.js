import express from "express";
import {
  getContracts,
  getContractById,
  sendForSignature,
  checkSignatureStatus,
  handleZohoSignWebhook,
  uploadSignedContract,
  generateContractPDF,
  createContract,
  deleteContract,
  updateContract
} from "../controllers/contractController.js";
import authMiddleware from "../middlewares/authVerify.js";
import multer from "multer";

const router = express.Router();

// Configure memory storage for ImageKit upload
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Get all contracts (admin only)
router.get("/", authMiddleware, getContracts);

// Create a contract (admin only)
router.post("/", authMiddleware, createContract);

// Get contract by ID (admin only)
router.get("/:id", authMiddleware, getContractById);

// Update a contract (admin only)
router.put("/:id", authMiddleware, updateContract);

// Delete a contract (admin only)
router.delete("/:id", authMiddleware, deleteContract);

// Send contract for digital signature (admin only)
router.post("/:id/send-for-signature", authMiddleware, sendForSignature);

// Check signature status (admin only)
router.get("/:id/signature-status", authMiddleware, checkSignatureStatus);

// Generate and download contract PDF
router.get("/:id/download-pdf", generateContractPDF);

// Upload a manually signed contract (frontdesk alternative)
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

export default router;
