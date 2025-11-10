import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { 
  getCabins, 
  createCabin, 
  getCabinById,
  updateCabin,
  deleteCabin,
  allocateCabin, 
  releaseCabin,
  getAvailableCabinsByBuilding,
  exportMasterFile
} from "../controllers/cabinController.js";

const router = express.Router();

// Export master file (must be before /:id route)
router.get("/export/master", exportMasterFile);

// List Cabins (filters: building, floor, status, type)
router.get("/", getCabins);

// Create Cabin/Desk
router.post("/", authMiddleware, createCabin);

// Get Cabin by ID
router.get("/:id", getCabinById);
router.put("/:id", authMiddleware, updateCabin);
router.delete("/:id", authMiddleware, deleteCabin);
router.post("/allocate", authMiddleware, allocateCabin);
router.post("/:id/release", authMiddleware, releaseCabin);
router.get("/building/:buildingId/available", getAvailableCabinsByBuilding);

export default router;
