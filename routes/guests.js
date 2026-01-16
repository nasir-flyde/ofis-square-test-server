import express from "express";
import { listGuests, getGuestById } from "../controllers/guestController.js";

const router = express.Router();

// Public/admin: list on-demand users (guests)
router.get("/", listGuests);

// Get guest by id
router.get("/:id", getGuestById);

export default router;
