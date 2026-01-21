import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import upload from "../middlewares/multer.js";
import {
  createDraftPayment,
  approveDraftPayment,
  rejectDraftPayment,
  getDraftPayments,
  getDraftPaymentById,
} from "../controllers/draftPaymentController.js";

const router = express.Router();
const clientBypassOr = (permission) => (req, res, next) => {
  try {
    const roleName = String(req?.userRole?.roleName || '').toLowerCase();
    if (roleName.includes('client')) {
      return next();
    }
  } catch (_) {}
  return checkPermission(permission)(req, res, next);
};
router.post(
  "/",
  authMiddleware,
  clientBypassOr(PERMISSIONS.DRAFT_PAYMENT_CREATE),
  upload.array('screenshots', 5),
  createDraftPayment
);
router.get(
  "/",
  authMiddleware,
  clientBypassOr(PERMISSIONS.DRAFT_PAYMENT_READ),
  getDraftPayments
);
router.get(
  "/:id",
  authMiddleware,
  checkPermission(PERMISSIONS.DRAFT_PAYMENT_READ),
  getDraftPaymentById
);
router.post(
  "/:id/approve",
  authMiddleware,
  checkPermission(PERMISSIONS.DRAFT_PAYMENT_APPROVE),
  approveDraftPayment
);
router.post(
  "/:id/reject",
  authMiddleware,
  checkPermission(PERMISSIONS.DRAFT_PAYMENT_REJECT),
  rejectDraftPayment
);

export default router;
