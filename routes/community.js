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
  getCommunityCabins,
  getCommunityMeetingRooms,
  getCommunityCommonAreas,
  getCommunityRFIDCards,
  assignCommunityCardToClient,
  downloadCommunityRFIDSample,
  importCommunityRFIDCards,
  downloadCommunityRFIDAssignSample,
  importCommunityRFIDCardAssignments,
  getCommunityTicketCategories,
  createCommunityTicket,
  getCommunityTicketById,
  updateCommunityTicket,
  deleteCommunityTicket,
  getCommunityVisitorStats,
  getCommunityTodayVisitors,
  getCommunityVisitors,
  getCommunityPendingVisitors,
  approveCommunityVisitorCheckIn,
  checkInCommunityVisitor,
  checkOutCommunityVisitor,
  scanCommunityVisitorQR,
  getCommunityEventRsvps,
  getCommunityPrinterRequests,
  markCommunityPrinterRequestReady,
  completeCommunityPrinterRequest,
  getCommunityDayPasses,
  getCommunityDayPassAvailability,
  createCommunitySingleDayPass,
  createCommunityDayPassBundle,
  createCommunityMeetingBooking,
  getCommunityMeetingBookings,
  getCommunityGuests,
  getCommunityGuestById
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
router.get("/clients/:id", getCommunityClientById);
router.get("/clients/:id/members", universalAuthMiddleware, getCommunityClientMembers);

// Building-specific clients for community users
router.get("/building-clients", communityMiddleware, getCommunityBuildingClients);

// Building-specific tickets for community users
router.get("/tickets", communityMiddleware, getCommunityTickets);
router.post("/tickets", communityMiddleware, createCommunityTicket);
router.get("/tickets/:id", communityMiddleware, getCommunityTicketById);
router.patch("/tickets/:id", communityMiddleware, updateCommunityTicket);
router.delete("/tickets/:id", communityMiddleware, deleteCommunityTicket);
router.get("/ticket-categories", communityMiddleware, getCommunityTicketCategories);

// Building-specific inventory for community users
router.get("/cabins", communityMiddleware, getCommunityCabins);
router.get("/meeting-rooms", communityMiddleware, getCommunityMeetingRooms);
router.get("/common-areas", communityMiddleware, getCommunityCommonAreas);
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
router.get("/events/:id/rsvps", communityMiddleware, getCommunityEventRsvps);
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

// RFID Card Management for Community
router.get("/rfid-cards", communityMiddleware, getCommunityRFIDCards);
router.post("/rfid-cards/:id/assign-client", communityMiddleware, assignCommunityCardToClient);

// CSV Import for RFID
const multer = (await import("multer")).default;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get("/rfid-cards/import/sample", communityMiddleware, downloadCommunityRFIDSample);
router.post("/rfid-cards/import", communityMiddleware, upload.single('file'), importCommunityRFIDCards);

// CSV Import for RFID Client Assignment
router.get("/rfid-cards/assign-client/import/sample", communityMiddleware, downloadCommunityRFIDAssignSample);
router.post("/rfid-cards/assign-client/import", communityMiddleware, upload.single('file'), importCommunityRFIDCardAssignments);

// Day Pass Bookings for Community
router.get("/day-passes", communityMiddleware, getCommunityDayPasses);
router.get("/day-passes/availability", communityMiddleware, getCommunityDayPassAvailability);
router.post("/day-passes/single", communityMiddleware, createCommunitySingleDayPass);
router.post("/day-passes/bundles", communityMiddleware, createCommunityDayPassBundle);

// Meeting Bookings for Community
router.get("/meeting-bookings", communityMiddleware, getCommunityMeetingBookings);
router.post("/meeting-bookings", communityMiddleware, createCommunityMeetingBooking);

// Guest/Ondemand User Management for Community
router.get("/guests", communityMiddleware, getCommunityGuests);
router.get("/guests/:id", communityMiddleware, getCommunityGuestById);

// Visitor Management for Community
router.get("/visitors/stats", communityMiddleware, getCommunityVisitorStats);
router.get("/visitors/today", communityMiddleware, getCommunityTodayVisitors);
router.get("/visitors", communityMiddleware, getCommunityVisitors);
router.get("/visitors/pending-checkin", communityMiddleware, getCommunityPendingVisitors);
router.post("/visitors/:id/approve-checkin", communityMiddleware, approveCommunityVisitorCheckIn);
router.patch("/visitors/:id/checkin", communityMiddleware, checkInCommunityVisitor);
router.patch("/visitors/:id/checkout", communityMiddleware, checkOutCommunityVisitor);
router.post("/visitors/scan", communityMiddleware, scanCommunityVisitorQR);

// Printer Requests for Community
router.get("/printer/requests", communityMiddleware, getCommunityPrinterRequests);
router.patch("/printer/requests/:id/ready", communityMiddleware, markCommunityPrinterRequestReady);
router.post("/printer/requests/:id/complete", communityMiddleware, completeCommunityPrinterRequest);

export default router;
