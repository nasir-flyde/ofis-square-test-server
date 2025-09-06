import express from "express";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Invoice from "../models/invoiceModel.js";

const router = express.Router();

// GET /api/me - returns client flags for navigation
router.get("/", clientMiddleware, async (req, res) => {
  try {
    const clientId = req.clientId;
    if (!clientId) {
      // If token has no clientId (e.g., admin token), return minimal structure
      return res.json({ client: null });
    }

    const client = await Client.findById(clientId).lean();
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Contract stage: get latest contract by createdAt
    const latestContract = await Contract.findOne({ client: clientId })
      .sort({ createdAt: -1 })
      .lean();
    const contractStage = latestContract?.status || null; // draft | pending_signature | active

    // Payment status: look at latest invoice; consider paid if status === 'paid' or balanceDue === 0
    const latestInvoice = await Invoice.findOne({ client: clientId })
      .sort({ createdAt: -1 })
      .lean();
    let paymentStatus = null;
    if (latestInvoice) {
      if (latestInvoice.status === "paid" || Number(latestInvoice.balanceDue || 0) === 0) paymentStatus = "paid";
      else if (latestInvoice.status === "overdue") paymentStatus = "overdue";
      else paymentStatus = "unpaid";
    }

    // Cabin allocation: naive derivation — treat active contract as allocated
    // Adjust when you add an explicit allocation model
    const cabinAllocated = latestContract?.status === "active";

    return res.json({
      client: {
        id: String(client._id),
        companyDetailsComplete: !!client.companyDetailsComplete,
        kycStatus: client.kycStatus || "none",
        contractStage: contractStage,
        cabinAllocated,
        paymentStatus,
      },
    });
  } catch (err) {
    console.error("/api/me error:", err);
    return res.status(500).json({ error: "Failed to compute client flags" });
  }
});

export default router;
