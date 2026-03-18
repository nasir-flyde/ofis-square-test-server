import express from "express";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import upload from "../middlewares/multer.js";
import printerRoutes from "./printer.js";
import {
  getMemberDashboard,
  getMyProfile,
  getHomePageData,
  getAppHomePageData,
  getMyTickets,
  createMyTicket,
  getMyBookings,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getMyVisitors,
  editMember,
  getAllEvents,
  deleteMyProfile
} from "../controllers/memberPortalController.js";

const router = express.Router();

router.get("/events", universalMiddleware, getAllEvents);
router.get("/me/tickets", universalMiddleware, getMyTickets);
router.get("/me/visitors", universalMiddleware, getMyVisitors);
router.post("/me/tickets", universalMiddleware, upload.any(), createMyTicket);
router.get("/me/notifications", universalMiddleware, getMyNotifications);
router.post("/me/notifications/:id/read", universalMiddleware, markNotificationRead);
router.post("/me/notifications/read-all", universalMiddleware, markAllNotificationsRead);
router.get("/me/bookings", universalMiddleware, getMyBookings);
router.get("/me/home", universalMiddleware, getHomePageData);
router.get("/me/app-home", universalMiddleware, getAppHomePageData);
router.get("/me", universalMiddleware, getMyProfile);
router.delete("/me", universalMiddleware, deleteMyProfile);
router.use(memberMiddleware);
router.get("/me/dashboard", getMemberDashboard);
router.put("/me/edit", universalMiddleware, editMember);
router.use("/printer", printerRoutes);



export default router;

