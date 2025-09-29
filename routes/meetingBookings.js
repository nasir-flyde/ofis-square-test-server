import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import universalMiddleware from "../middlewares/universalAuthVerify.js";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { createBooking, listBookings, cancelBooking, utilizationReport } from "../controllers/meetingBookingController.js";

const router = express.Router();

// Booking CRUD
router.get("/",listBookings);
router.post("/", authMiddleware,createBooking);
// Client access to create bookings
router.post("/client", universalMiddleware, createBooking);
router.patch("/:id/cancel", authMiddleware, cancelBooking);

// Reports
router.get("/reports/utilization", authMiddleware, utilizationReport);

export default router;
