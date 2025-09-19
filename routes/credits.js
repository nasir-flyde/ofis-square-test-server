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
  getCustomItem
} from "../controllers/creditCustomItemController.js";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";


const router = express.Router();

router.get("/summary/:clientId", clientMiddleware, getClientCredits);
router.get("/summary", clientMiddleware, getClientCredits);
router.get("/alerts", getCreditAlerts);
router.post("/consolidate", authMiddleware, triggerCreditConsolidation);
router.get("/transactions/:clientId", clientMiddleware, getClientCreditTransactions);
router.get("/transactions", clientMiddleware, getClientCreditTransactions);
router.post("/transactions", authMiddleware, recordCreditTransaction);
router.post("/grant", authMiddleware, grantCredits);
router.get("/grant/preview", authMiddleware, previewCreditGrant);
router.post("/exceeded-invoice", authMiddleware, generateExceededCreditsInvoice);
router.post("/consume-item", authMiddleware, consumeCreditsForItem);
router.put("/contract/:contractId", authMiddleware, updateContractCredits);
router.put("/contract/:contractId", authMiddleware, updateContractCredits);

// Custom items management (admin)
router.get("/custom-items", authMiddleware, getCustomItems);
router.post("/custom-items", authMiddleware, createCustomItem);
router.get("/custom-items/:id", authMiddleware, getCustomItem);
router.put("/custom-items/:id", authMiddleware, updateCustomItem);
router.patch("/custom-items/:id/activate", authMiddleware, toggleCustomItemStatus);
router.delete("/custom-items/:id", authMiddleware, deleteCustomItem);

export default router;
