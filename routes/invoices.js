import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  pushInvoiceToZoho,
  pushInvoiceToZohoGuest,
  sendInvoiceEmail,
  syncInvoiceFromZoho,
  getInvoicePdf,
  getInvoiceZohoLinks,
  getInvoiceZohoPdfBinary,
  recordInvoicePayment,
  zohoWebhook,
  downloadInvoicePdf,
  deleteInvoice,
  consolidateInvoices,
  getConsolidationPreview,
  getInvoicePayments,
  sendInvoiceViaEmail,
  markInvoiceAsPaid,
  markInvoiceAsSent,
  uploadEInvoice,
} from "../controllers/invoiceController.js";
import multer from "multer";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.get("/", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getInvoices);
router.get("/consolidation-preview", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getConsolidationPreview);
router.post("/", authMiddleware, checkPermission(PERMISSIONS.INVOICE_CREATE), createInvoice);
router.post("/consolidate", authMiddleware, checkPermission(PERMISSIONS.INVOICE_SEND), consolidateInvoices);
router.get("/:id", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getInvoiceById);
router.patch("/:id/status", authMiddleware, checkPermission(PERMISSIONS.INVOICE_UPDATE), updateInvoiceStatus);
router.post("/:id/push-zoho", authMiddleware, pushInvoiceToZoho);
// Guest-specific push: allow creators to push as draft for ondemand users
router.post("/:id/push-zoho-guest", authMiddleware, pushInvoiceToZohoGuest);
// Allow creators to push only as draft
router.post(
  "/:id/push-zoho-draft",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_CREATE),
  (req, res) => {
    req.body = req.body || {};
    req.body.sendStatus = 'draft';
    return pushInvoiceToZoho(req, res);
  }
);
router.post("/:id/send", authMiddleware, checkPermission(PERMISSIONS.INVOICE_SEND), sendInvoiceEmail);
router.post("/:id/mark-sent", authMiddleware, checkPermission(PERMISSIONS.INVOICE_SEND), markInvoiceAsSent);
router.post("/:id/sync", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), syncInvoiceFromZoho);
router.get("/:id/pdf", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getInvoicePdf);
router.get("/:id/zoho-links", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getInvoiceZohoLinks);
router.get("/:id/zoho-pdf",getInvoiceZohoPdfBinary);
router.get("/:id/download-pdf", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), downloadInvoicePdf);
router.post("/:id/payments", authMiddleware, checkPermission(PERMISSIONS.PAYMENT_CREATE), recordInvoicePayment);
router.get("/:id/payments", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getInvoicePayments);
router.post("/:id/send-email", authMiddleware, checkPermission(PERMISSIONS.INVOICE_SEND), sendInvoiceViaEmail);
router.post("/:id/mark-paid", authMiddleware, checkPermission(PERMISSIONS.PAYMENT_CREATE), markInvoiceAsPaid);
// Upload E-Invoice (file or fileUrl)
router.post("/:id/upload-e-invoice", authMiddleware, checkPermission(PERMISSIONS.INVOICE_UPDATE), upload.any(), uploadEInvoice);
router.delete("/:id", authMiddleware, checkPermission(PERMISSIONS.INVOICE_DELETE), deleteInvoice);

// Webhook (no auth)
router.post("/webhook/zoho", zohoWebhook);

export default router;