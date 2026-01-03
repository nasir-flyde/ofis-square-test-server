import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import universalMiddleware from "../middlewares/universalAuthVerify.js";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { createBooking, listBookings, cancelBooking, utilizationReport, getBookingById, getBookingsByMember, addVisitorToBooking, requestDiscount, approveDiscount, rejectDiscount, listDiscountRequests } from "../controllers/meetingBookingController.js";

const router = express.Router();

// Booking CRUD
router.get("/",listBookings);
router.get("/member/my-bookings", universalMiddleware, getBookingsByMember); // Get authenticated member's bookings
router.get("/member/:memberId", universalMiddleware, getBookingsByMember); // Get specific member's bookings
// Admin/staff listing of discount requests (optionally filtered by building)
router.get("/discount-requests", authMiddleware, listDiscountRequests);
router.get("/:id", getBookingById);
router.post("/", authMiddleware,createBooking);
// Client access to create bookings
router.post("/client", universalMiddleware, createBooking);
router.patch("/:id/cancel", authMiddleware, cancelBooking);

// Add a visitor (existing or new) to a booking
router.post("/:id/visitors", addVisitorToBooking);

// Discount workflow
// Community users can request discount on a booking
router.post("/:id/discount/request", communityMiddleware, requestDiscount);
// Admin/staff approve or reject discount requests
router.post("/:id/discount/approve", authMiddleware, approveDiscount);
router.post("/:id/discount/reject", authMiddleware, rejectDiscount);

// Reports
router.get("/reports/utilization", authMiddleware, utilizationReport);

export default router;
