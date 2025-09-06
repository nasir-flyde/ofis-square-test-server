import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { getCabins, createCabin, allocateCabin, releaseCabin } from "../controllers/cabinController.js";

const router = express.Router();

// List Cabins (filters: building, floor, status, type)
router.get("/", authMiddleware, getCabins);

// Create Cabin/Desk
router.post("/", authMiddleware, createCabin);

// Allocate Cabin to Client (infers active contract; no contractId needed)
router.post("/allocate", authMiddleware, allocateCabin);

// Release Cabin
router.post("/:id/release", authMiddleware, releaseCabin);

export default router;
