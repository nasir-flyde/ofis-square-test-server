import express from "express";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import { kycUploads } from "../middlewares/multer.js";
import {
  createClient,
  upsertBasicDetails,
  getClients,
  getClientById,
  updateClient,
  deleteClient,
  submitKycDocuments,
  verifyKyc,
  rejectKyc,
} from "../controllers/clientController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();



router.post("/", createClient);
// Requires JWT; clientMiddleware extracts clientId for the controller
router.post("/basic-details", authMiddleware, upsertBasicDetails);
router.get("/", getClients);
router.get("/:id", getClientById);
router.put("/:id", updateClient);
router.delete("/:id", deleteClient);
// Accept file uploads (memory storage) for KYC documents
router.post("/:id/kyc",authMiddleware, kycUploads, submitKycDocuments);
router.post("/:id/kyc/verify",authMiddleware, verifyKyc);
router.post("/:id/kyc/reject", authMiddleware, rejectKyc);

export default router;
