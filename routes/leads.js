import express from "express";
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  getLeadStats
} from "../controllers/leadController.js";


const router = express.Router();

// Public route for signup (no authentication required)
router.post("/signup", createLead);

// Protected routes (require admin authentication)
router.get("/", getLeads);
router.get("/stats", getLeadStats);
router.get("/:id", getLeadById);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

export default router;
