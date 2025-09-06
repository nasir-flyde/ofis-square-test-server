import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { 
  getCabins, 
  createCabin, 
  getCabinById,
  updateCabin,
  deleteCabin,
  allocateCabin, 
  releaseCabin 
} from "../controllers/cabinController.js";

const router = express.Router();

// List Cabins (filters: building, floor, status, type)
router.get("/", getCabins);

// Create Cabin/Desk
router.post("/", authMiddleware, createCabin);

// Get Cabin by ID
router.get("/:id", getCabinById);

// Update Cabin
router.put("/:id", authMiddleware, updateCabin);

// Delete Cabin
router.delete("/:id", authMiddleware, deleteCabin);

// Allocate Cabin to Client (infers active contract; no contractId needed)
router.post("/allocate", authMiddleware, allocateCabin);

// Release Cabin
router.post("/:id/release", authMiddleware, releaseCabin);

export default router;
