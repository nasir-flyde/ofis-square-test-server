import express from "express";
import { 
  getCommunityDashboard, 
  getCommunityStats,
  getCommunityClients,
  getCommunityClientById,
  getCommunityClientMembers
} from "../controllers/communityController.js";
import { createBooking as createMeetingBooking } from "../controllers/meetingBookingController.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";

const router = express.Router();

// Community dashboard routes
router.get("/dashboard", communityMiddleware, getCommunityDashboard);
router.get("/stats", communityMiddleware, getCommunityStats);

// Clients and Members (Community access)
router.get("/clients", communityMiddleware, getCommunityClients);
router.get("/clients/:id", communityMiddleware, getCommunityClientById);
router.get("/clients/:id/members", communityMiddleware, getCommunityClientMembers);

// Meeting bookings (Community access)
router.post("/meeting-bookings", communityMiddleware, createMeetingBooking);

export default router;
