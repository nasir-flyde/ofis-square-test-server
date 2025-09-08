import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  pushInvoiceToZoho,
  sendInvoiceEmail,
  syncInvoiceFromZoho,
  getInvoicePdf,
  recordInvoicePayment,
  zohoWebhook,
  downloadInvoicePdf,
} from "../controllers/invoiceController.js";

const router = express.Router();


router.get("/", getInvoices);
router.post("/", authMiddleware, createInvoice);
router.get("/:id", authMiddleware, getInvoiceById);
router.patch("/:id/status", authMiddleware, updateInvoiceStatus);

// Zoho Books integration
router.post("/:id/push-zoho",pushInvoiceToZoho);
router.post("/:id/send", authMiddleware, sendInvoiceEmail);
router.post("/:id/sync", authMiddleware, syncInvoiceFromZoho);
router.get("/:id/pdf", authMiddleware, getInvoicePdf);
router.get("/:id/download-pdf", authMiddleware, downloadInvoicePdf);
router.post("/:id/payments", authMiddleware, recordInvoicePayment);

// Webhook (no auth)
router.post("/webhook/zoho", zohoWebhook);

export default router;