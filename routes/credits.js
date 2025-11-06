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
  consumeCreditsForItem
} from "../controllers/creditController.js";
import {
  getCustomItems,
  createCustomItem,
  updateCustomItem,
  toggleCustomItemStatus,
  deleteCustomItem,
  getCustomItem,
  syncItemToZoho,
  bulkSyncToZoho,
  getZohoBooksItems,
  linkZohoItem,
  unlinkZohoItem,
  getSyncStatus
} from "../controllers/creditCustomItemController.js";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";
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
router.get("/grant/preview", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), previewCreditGrant);
router.post("/exceeded-invoice", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), generateExceededCreditsInvoice);
router.post("/consume-item", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), consumeCreditsForItem);
router.put("/contract/:contractId", authMiddleware, populateUserRole, requirePermission(PERMISSIONS.CLIENT_UPDATE), updateContractCredits);

// Custom items management (admin)
router.get("/custom-items", authMiddleware, getCustomItems);
router.post("/custom-items", authMiddleware, createCustomItem);
router.get("/custom-items/:id", authMiddleware, getCustomItem);
router.put("/custom-items/:id", authMiddleware, updateCustomItem);
router.patch("/custom-items/:id/activate", authMiddleware, toggleCustomItemStatus);
router.delete("/custom-items/:id", authMiddleware, deleteCustomItem);

// Zoho Books sync endpoints
router.get("/custom-items/sync-status", authMiddleware, getSyncStatus);
router.get("/custom-items/zoho-items", authMiddleware, getZohoBooksItems);
router.post("/custom-items/bulk-sync", authMiddleware, bulkSyncToZoho);
router.post("/custom-items/:id/sync-to-zoho", authMiddleware, syncItemToZoho);
router.post("/custom-items/:id/link-zoho", authMiddleware, linkZohoItem);
router.delete("/custom-items/:id/unlink-zoho", authMiddleware, unlinkZohoItem);

export default router;
