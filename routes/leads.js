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

router.post("/signup", uploadKYCDocuments, handleUploadError, createLead);

router.get("/", authMiddleware, getLeads);
router.get("/stats", authMiddleware, getLeadStats);
router.get("/kyc/pending", authMiddleware, getPendingKYCLeads);
router.get("/guests/search", authMiddleware, searchGuests);
router.get("/:id", authMiddleware, getLeadById);
router.put("/:id", authMiddleware, updateLead);
router.delete("/:id", authMiddleware, deleteLead);
router.put("/:id/kyc/upload", authMiddleware, uploadKYCDocuments, handleUploadError, uploadKYCByAdmin);
router.post("/:id/kyc/approve", authMiddleware, approveKYC);
router.post("/:id/kyc/reject", authMiddleware, rejectKYC);

export default router;
