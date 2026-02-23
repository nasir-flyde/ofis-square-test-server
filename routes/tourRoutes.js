import express from "express";
import {
    getAvailableSlots,
    bookTour,
    createTourSlot
} from "../controllers/tourController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

// Public/Lead routes
router.get("/slots/:cityId", getAvailableSlots);
router.post("/book", bookTour);

// Admin/Staff routes
router.post("/slots", authMiddleware, createTourSlot);

export default router;
