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

// All other routes require member authentication
router.use(memberMiddleware);
router.get("/me/dashboard", getMemberDashboard);
router.get("/me", getMyProfile);
router.post("/me/tickets", upload.any(), createMyTicket);
router.get("/me/bookings", getMyBookings);
router.get("/me/notifications", getMyNotifications);
router.post("/me/notifications/:id/read", markNotificationRead);
router.post("/me/notifications/read-all", markAllNotificationsRead);

export default router;
