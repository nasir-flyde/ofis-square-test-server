import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { getDesks, createDesk, allocateDesk, releaseDesk } from "../controllers/deskController.js";

const router = express.Router();

// List Desks (filters: building, cabin, status)
router.get("/", authMiddleware, getDesks);

// Create Desk under a Cabin
router.post("/", authMiddleware, createDesk);

// Allocate Desk to Client (infers active contract; no contractId needed)
router.post("/allocate", authMiddleware, allocateDesk);

// Release Desk
router.post("/:id/release", authMiddleware, releaseDesk);

export default router;
