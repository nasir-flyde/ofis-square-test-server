import express from "express";
import memberMiddleware from "../middlewares/memberMiddleware.js";
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

// All routes require member authentication
router.use(memberMiddleware);

// Dashboard route
router.get("/me/dashboard", getMemberDashboard);

// Profile routes
router.get("/me", getMyProfile);

// Ticket routes
router.get("/me/tickets", getMyTickets);
router.post("/me/tickets", createMyTicket);

// Booking routes
router.get("/me/bookings", getMyBookings);

// Notification routes
router.get("/me/notifications", getMyNotifications);
router.post("/me/notifications/:id/read", markNotificationRead);
router.post("/me/notifications/read-all", markAllNotificationsRead);

export default router;
