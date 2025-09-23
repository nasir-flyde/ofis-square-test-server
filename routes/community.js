import express from "express";
import {
  getCommunityDashboard,
  getCommunityStats,
  getCommunityClients,
  getCommunityClientById,
  getCommunityClientMembers,
  getCommunityTickets,
  getCommunityBuildingClients,
  getCommunityInventory,
} from "../controllers/communityController.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";

const router = express.Router();

// Community dashboard and stats
router.get("/dashboard", communityMiddleware, getCommunityDashboard);
router.get("/stats", communityMiddleware, getCommunityStats);

// Community clients
router.get("/clients", communityMiddleware, getCommunityClients);
router.get("/clients/:id", communityMiddleware, getCommunityClientById);
router.get("/clients/:id/members", communityMiddleware, getCommunityClientMembers);

// Building-specific clients for community users
router.get("/building-clients", communityMiddleware, getCommunityBuildingClients);

// Building-specific tickets for community users
router.get("/tickets", communityMiddleware, getCommunityTickets);

// Building-specific inventory for community users
router.get("/inventory", communityMiddleware, getCommunityInventory);

export default router;
