import express from "express";
import WalletService from "../services/walletService.js";
import authVerify from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";

const router = express.Router();

// Get wallet info for a client
router.get("/:clientId", authVerify, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const wallet = await WalletService.getWalletInfo(clientId);
    
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    
    res.json({
      success: true,
      data: {
        clientId: wallet.client._id,
        clientName: wallet.client.name,
        balance: wallet.balance,
        creditValue: wallet.creditValue,
        currency: wallet.currency,
        status: wallet.status,
        expiresAt: wallet.expiresAt,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      }
    });
  } catch (error) {
    console.error("Get wallet error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get wallet transactions
router.get("/:clientId/transactions", authVerify, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { type, member, page, limit } = req.query;
    
    const result = await WalletService.getTransactions(clientId, {
      type,
      member,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    
    res.json({
      success: true,
      data: result.transactions,
      pagination: result.pagination
    });
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Adjust credits (admin only)
router.post("/:clientId/adjust", authVerify, checkPermission("admin"), async (req, res) => {
  try {
    const { clientId } = req.params;
    const { credits, reason } = req.body;
    
    if (!credits || !reason) {
      return res.status(400).json({ error: "Credits and reason are required" });
    }
    
    if (!Number.isInteger(credits) || credits === 0) {
      return res.status(400).json({ error: "Credits must be a non-zero integer" });
    }
    
    const result = await WalletService.adjustCredits({
      clientId,
      credits,
      reason,
      approvedBy: req.user.id
    });
    
    res.json(result);
  } catch (error) {
    console.error("Adjust credits error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Refund credits (admin only) - placeholder for future implementation
router.post("/:clientId/refund", authVerify, checkPermission("admin"), async (req, res) => {
  try {
    // TODO: Implement refund logic
    res.status(501).json({ error: "Refund functionality not yet implemented" });
  } catch (error) {
    console.error("Refund credits error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
