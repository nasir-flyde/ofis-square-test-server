import express from "express";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import upload from "../middlewares/multer.js";
import {
  getMemberDashboard,
  getMyProfile,
  getMyTickets,
  createMyTicket,
  getMyBookings,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from "../controllers/memberPortalController.js";

const router = express.Router();

// Allow clients and members to fetch tickets via universal auth
router.get("/me/tickets", universalMiddleware, getMyTickets);

// Allow clients and members to access notifications via universal auth
router.get("/me/notifications", universalMiddleware, getMyNotifications);
router.post("/me/notifications/:id/read", universalMiddleware, markNotificationRead);
router.post("/me/notifications/read-all", universalMiddleware, markAllNotificationsRead);

// All other routes require member authentication
router.use(memberMiddleware);
router.get("/me/dashboard", getMemberDashboard);
router.get("/me", getMyProfile);
router.post("/me/tickets", upload.any(), createMyTicket);
router.get("/me/bookings", getMyBookings);

export default router;
