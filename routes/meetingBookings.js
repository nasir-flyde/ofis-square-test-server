import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import universalMiddleware from "../middlewares/universalAuthVerify.js";
import memberMiddleware from "../middlewares/memberMiddleware.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { createBooking, listBookings, cancelBooking, utilizationReport, getBookingById, getBookingsByMember, addVisitorToBooking, requestDiscount, approveDiscount, rejectDiscount, listDiscountRequests, provisionAccess, payBooking } from "../controllers/meetingBookingController.js";

const router = express.Router();

router.get("/", listBookings);
router.get("/member/my-bookings", universalMiddleware, getBookingsByMember);
router.get("/member/:memberId", universalMiddleware, getBookingsByMember);
router.get("/discount-requests", authMiddleware, listDiscountRequests);
router.get("/:id", getBookingById);
router.post("/", authMiddleware, createBooking);
router.post("/client", universalMiddleware, createBooking);
router.patch("/:id/cancel", authMiddleware, cancelBooking);
router.post("/:id/pay", authMiddleware, payBooking);
router.post("/:id/visitors", addVisitorToBooking);
router.post("/:id/discount/request", communityMiddleware, requestDiscount);
router.post("/:id/discount/approve", authMiddleware, approveDiscount);
router.post("/:id/discount/reject", authMiddleware, rejectDiscount);
router.post("/:id/provision-access", provisionAccess);

// Reports
router.get("/reports/utilization", authMiddleware, utilizationReport);

export default router;
