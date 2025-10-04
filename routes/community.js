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
  getCommunityEvents,
  getCommunityEventCategories,
  getCommunityEventById,
  rsvpToEvent,
  cancelRsvp,
  createCommunityEvent,
  updateCommunityEvent,
  deleteCommunityEvent,
  publishCommunityEvent,
} from "../controllers/communityController.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";

const router = express.Router();

// Community dashboard and stats
router.get("/dashboard", communityMiddleware, getCommunityDashboard);
router.get("/stats", communityMiddleware, getCommunityStats);

// Community clients
router.get("/clients", communityMiddleware, getCommunityClients);
router.get("/clients/:id", communityMiddleware, getCommunityClientById);
router.get("/clients/:id/members", universalAuthMiddleware, getCommunityClientMembers);

// Building-specific clients for community users
router.get("/building-clients", communityMiddleware, getCommunityBuildingClients);

// Building-specific tickets for community users
router.get("/tickets", communityMiddleware, getCommunityTickets);

// Building-specific inventory for community users
router.get("/inventory", communityMiddleware, getCommunityInventory);

// Building-specific events for community users
router.get("/events", communityMiddleware, getCommunityEvents);
router.get("/events/:id", communityMiddleware, getCommunityEventById);
router.post("/events/:id/rsvp", communityMiddleware, rsvpToEvent);
router.delete("/events/:id/rsvp", communityMiddleware, cancelRsvp);
router.post("/events", communityMiddleware, createCommunityEvent);
router.put("/events/:id", communityMiddleware, updateCommunityEvent);
router.delete("/events/:id", communityMiddleware, deleteCommunityEvent);
router.patch("/events/:id/publish", communityMiddleware, publishCommunityEvent);
router.get("/event-categories", communityMiddleware, getCommunityEventCategories);

export default router;
