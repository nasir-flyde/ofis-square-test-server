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
  uploadKYCByAdmin,
  searchGuests,
} from "../controllers/leadController.js";
import { uploadKYCDocuments, handleUploadError } from "../middlewares/uploadMiddleware.js";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";


const router = express.Router();

// Public route for signup (no authentication required)
router.post("/signup", uploadKYCDocuments, handleUploadError, createLead);

// Protected routes (require authentication)
router.get("/", authMiddleware, getLeads);
router.get("/stats", authMiddleware, getLeadStats);
router.get("/kyc/pending", authMiddleware, getPendingKYCLeads);
// Guest search for community/ops to select ondemand users
router.get("/guests/search", authMiddleware, searchGuests);
router.get("/:id", authMiddleware, getLeadById);
router.put("/:id", authMiddleware, updateLead);
router.delete("/:id", authMiddleware, deleteLead);

// KYC approval routes (require client approval permission)
router.put("/:id/kyc/upload", authMiddleware, uploadKYCDocuments, handleUploadError, uploadKYCByAdmin);
router.post("/:id/kyc/approve", authMiddleware, approveKYC);
router.post("/:id/kyc/reject", authMiddleware, rejectKYC);

export default router;
