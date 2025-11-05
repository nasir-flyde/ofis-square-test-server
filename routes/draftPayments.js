import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import upload from "../middlewares/multer.js";
import {
  createDraftPayment,
  approveDraftPayment,
  rejectDraftPayment,
  getDraftPayments,
  getDraftPaymentById,
} from "../controllers/draftPaymentController.js";

const router = express.Router();

// All authenticated users can access draft payments (role-based restrictions in controller)
router.post("/", authMiddleware, upload.array('screenshots', 5), createDraftPayment);
router.get("/", authMiddleware, getDraftPayments);
router.get("/:id", authMiddleware, getDraftPaymentById);
router.post("/:id/approve", authMiddleware, approveDraftPayment);
router.post("/:id/reject", authMiddleware, rejectDraftPayment);

export default router;
