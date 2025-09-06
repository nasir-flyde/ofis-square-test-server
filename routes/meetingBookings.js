import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { createBooking, listBookings, cancelBooking, utilizationReport } from "../controllers/meetingBookingController.js";

const router = express.Router();

// Booking CRUD
router.get("/", authMiddleware, listBookings);
router.post("/", authMiddleware, createBooking);
router.patch("/:id/cancel", authMiddleware, cancelBooking);

// Reports
router.get("/reports/utilization", authMiddleware, utilizationReport);

export default router;
