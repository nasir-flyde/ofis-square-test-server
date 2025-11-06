import express from "express";
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  getLeadStats,
  approveKYC,
  rejectKYC,
  getPendingKYCLeads,
  uploadKYCByAdmin
} from "../controllers/leadController.js";
import { uploadKYCDocuments, handleUploadError } from "../middlewares/uploadMiddleware.js";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";


const router = express.Router();

// Public route for signup (no authentication required)
router.post("/signup", uploadKYCDocuments, handleUploadError, createLead);

// Protected routes (require authentication)
router.get("/", authMiddleware, checkPermission(PERMISSIONS.CLIENT_READ), getLeads);
router.get("/stats", authMiddleware, checkPermission(PERMISSIONS.CLIENT_READ), getLeadStats);
router.get("/kyc/pending", authMiddleware, checkPermission(PERMISSIONS.CLIENT_READ), getPendingKYCLeads);
router.get("/:id", authMiddleware, checkPermission(PERMISSIONS.CLIENT_READ), getLeadById);
router.put("/:id", authMiddleware, checkPermission(PERMISSIONS.CLIENT_UPDATE), updateLead);
router.delete("/:id", authMiddleware, checkPermission(PERMISSIONS.CLIENT_DELETE), deleteLead);

// KYC approval routes (require client approval permission)
router.put("/:id/kyc/upload", authMiddleware, checkPermission(PERMISSIONS.CLIENT_APPROVE), uploadKYCDocuments, handleUploadError, uploadKYCByAdmin);
router.post("/:id/kyc/approve", authMiddleware, checkPermission(PERMISSIONS.CLIENT_APPROVE), approveKYC);
router.post("/:id/kyc/reject", authMiddleware, checkPermission(PERMISSIONS.CLIENT_APPROVE), rejectKYC);

export default router;
