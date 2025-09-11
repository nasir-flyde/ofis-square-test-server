import express from "express";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import authMiddleware from "../middlewares/authVerify.js";
import {
  createDraftPayment,
  approveDraftPayment,
  rejectDraftPayment,
  getDraftPayments,
  getDraftPaymentById,
} from "../controllers/draftPaymentController.js";

const router = express.Router();

// Client or Admin can create a draft payment
router.post("/", clientMiddleware, createDraftPayment);
router.get("/", clientMiddleware, getDraftPayments);
router.get("/:id", clientMiddleware, getDraftPaymentById);
router.post("/:id/approve", authMiddleware, approveDraftPayment);
router.post("/:id/reject", authMiddleware, rejectDraftPayment);

export default router;
