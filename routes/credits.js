import express from "express";
import {
  getClientCredits,
  getCreditAlerts,
  triggerCreditConsolidation,
  getClientCreditTransactions,
  grantCredits,
  updateContractCredits
} from "../controllers/creditController.js";
import authMiddleware from "../middlewares/authVerify.js";


const router = express.Router();

router.get("/summary/:clientId",authMiddleware, getClientCredits);
router.get("/alerts",getCreditAlerts);
router.post("/consolidate",authMiddleware, triggerCreditConsolidation);
router.get("/transactions/:clientId",authMiddleware, getClientCreditTransactions);
router.post("/grant", authMiddleware, grantCredits);
router.put("/contract/:contractId", authMiddleware, updateContractCredits);

export default router;
