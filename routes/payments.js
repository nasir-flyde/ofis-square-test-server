import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { createPayment, getPayments, getPaymentById, deletePayment } from "../controllers/paymentController.js";

const router = express.Router();

// List payments (filters: invoice, client, type, from, to)
router.get("/", authMiddleware, getPayments);

// Create a payment (updates related invoice totals)
router.post("/", authMiddleware, createPayment);

// Get payment by ID
router.get("/:id", authMiddleware, getPaymentById);

// Delete payment by ID
router.delete("/:id", authMiddleware, deletePayment);

export default router;
