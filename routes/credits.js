import express from "express";
import {
  getClientCredits,
  getCreditAlerts,
  triggerCreditConsolidation,
  getClientCreditTransactions,
  grantCredits,
  previewCreditGrant,
  recordCreditTransaction,
  updateContractCredits,
  generateExceededCreditsInvoice,
  deductCredits
} from "../controllers/creditController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";

const router = express.Router();

// Read-only endpoints - require client:read permission
router.get("/summary/:clientId", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_READ), getClientCredits);
router.get("/summary", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_READ), getClientCredits);
router.get("/alerts", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_READ), getCreditAlerts);
router.get("/transactions/:clientId", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_READ), getClientCreditTransactions);
router.get("/transactions", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_READ), getClientCreditTransactions);

// Write endpoints - require client:update permission
router.post("/consolidate", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), triggerCreditConsolidation);
router.post("/transactions", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), recordCreditTransaction);
router.post("/grant", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), grantCredits);
router.post("/deduct", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), deductCredits);
router.get("/grant/preview", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), previewCreditGrant);
router.post("/exceeded-invoice", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), generateExceededCreditsInvoice);
router.put("/contract/:contractId", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), updateContractCredits);

export default router;
