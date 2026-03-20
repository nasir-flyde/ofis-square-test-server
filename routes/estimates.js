import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  createProforma,
  getProformas,
  getProformaById,
  pushProformaToZoho,
  syncProformaFromZoho,
  convertProformaToInvoice,
  approveProforma,
  rejectProforma,
  deleteProforma
} from "../controllers/estimateController.js";

const router = express.Router();

router.get("/", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getProformas);
router.post("/", authMiddleware, checkPermission(PERMISSIONS.INVOICE_CREATE), createProforma);
router.get("/:id", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), getProformaById);
router.post("/:id/push-zoho", authMiddleware, checkPermission(PERMISSIONS.INVOICE_SEND), pushProformaToZoho);
// Allow creators to push only as draft (no send permission required)
router.post(
  "/:id/push-zoho-draft",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_CREATE),
  (req, res) => {
    req.body = req.body || {};
    req.body.sendStatus = 'draft';
    return pushProformaToZoho(req, res);
  }
);
// Convert estimate to invoice and send to Zoho (sent status)
router.post(
  "/:id/convert-to-invoice",
  authMiddleware,
  checkPermission(PERMISSIONS.INVOICE_SEND),
  convertProformaToInvoice
);
router.post("/:id/sync", authMiddleware, checkPermission(PERMISSIONS.INVOICE_READ), syncProformaFromZoho);
router.post("/:id/approve", authMiddleware, checkPermission(PERMISSIONS.INVOICE_APPROVE), approveProforma);
router.post("/:id/reject", authMiddleware, checkPermission(PERMISSIONS.INVOICE_APPROVE), rejectProforma);
router.delete("/:id", authMiddleware, checkPermission(PERMISSIONS.INVOICE_DELETE), deleteProforma);


export default router;
