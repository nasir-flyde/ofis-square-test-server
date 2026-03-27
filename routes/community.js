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
import { sendCommunityCustomNotification } from "../controllers/notificationController.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";

const router = express.Router();

// Community dashboard and stats
router.get("/dashboard", communityMiddleware, getCommunityDashboard);
router.get("/stats", communityMiddleware, getCommunityStats);

// Community clients
router.get("/clients", communityMiddleware, getCommunityClients);
router.get("/clients/:id",getCommunityClientById);
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

// Custom notifications sent by the community team
router.post("/notifications/send", communityMiddleware, sendCommunityCustomNotification);

// Members in this building – used by the frontend member-picker
router.get("/members", communityMiddleware, async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) return res.status(400).json({ success: false, message: 'No building context' });
    const Client = (await import('../models/clientModel.js')).default;
    const Member = (await import('../models/memberModel.js')).default;
    const clients = await Client.find({ building: buildingId }).select('_id');
    const clientIds = clients.map(c => c._id);
    const members = await Member.find({ client: { $in: clientIds } })
      .select('_id firstName lastName email phone')
      .sort({ firstName: 1 });
    return res.json({ success: true, data: members });
  } catch (err) {
    console.error('community/members error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch members' });
  }
});

export default router;
