import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import upload from "../middlewares/multer.js";
import {
  createPayment,
  getPayments,
  getPaymentById,
  deletePayment,
  createRazorpayOrder,
  handleRazorpaySuccess,
  handleRazorpayWebhook,
  recordCustomerPayment,
  listCustomerPayments,
  payWithCredits,
  getMemberCreditBalance,
  getClientCreditBalance
} from "../controllers/paymentController.js";

const router = express.Router();

// List payments (filters: invoice, client, type, from, to)
router.get("/", authMiddleware, getPayments);

// Create a payment (updates related invoice totals)
router.post(
  "/",
  authMiddleware,
  upload.fields([
    { name: 'screenshots', maxCount: 5 },
    { name: 'images', maxCount: 5 }
  ]),
  createPayment
);

// Get payment by ID
router.get("/:id", authMiddleware, getPaymentById);

// Delete payment by ID
router.delete("/:id", authMiddleware, deletePayment);

// Zoho Books Customer Payment routes
// Record customer payment in Zoho Books (supports multiple invoices)
router.post("/zoho-customer-payment", authMiddleware, recordCustomerPayment);

// List customer payments from Zoho Books
router.get("/zoho-customer-payments", authMiddleware, listCustomerPayments);

// Razorpay day pass payment routes
router.post("/razorpay/create-order", createRazorpayOrder);
router.post("/razorpay/success", handleRazorpaySuccess);
router.post("/razorpay/webhook", handleRazorpayWebhook);

// Credit payment routes
router.post('/credits/pay', payWithCredits);
router.get('/credits/balance/:memberId', getMemberCreditBalance);
router.get('/credits/balance/client/:clientId', getClientCreditBalance);

export default router;
