import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import universalMiddleware from "../middlewares/universalAuthVerify.js";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { createBooking, listBookings, cancelBooking, utilizationReport, getBookingById, getBookingsByMember } from "../controllers/meetingBookingController.js";

const router = express.Router();

// Booking CRUD
router.get("/",listBookings);
router.get("/member/my-bookings", universalMiddleware, getBookingsByMember); // Get authenticated member's bookings
router.get("/member/:memberId", universalMiddleware, getBookingsByMember); // Get specific member's bookings
router.get("/:id", getBookingById);
router.post("/", authMiddleware,createBooking);
// Client access to create bookings
router.post("/client", universalMiddleware, createBooking);
router.patch("/:id/cancel", authMiddleware, cancelBooking);

// Reports
router.get("/reports/utilization", authMiddleware, utilizationReport);

export default router;
