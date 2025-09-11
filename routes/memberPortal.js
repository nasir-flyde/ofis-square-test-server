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
router.get("/me/dashboard", getMemberDashboard);
router.get("/me", getMyProfile);
router.get("/me/tickets", getMyTickets);
router.post("/me/tickets", createMyTicket);
router.get("/me/bookings", getMyBookings);
router.get("/me/notifications", getMyNotifications);
router.post("/me/notifications/:id/read", markNotificationRead);
router.post("/me/notifications/read-all", markAllNotificationsRead);

export default router;
