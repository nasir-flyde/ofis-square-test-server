import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { 
  createBuilding, 
  getBuildings, 
  getBuildingById, 
  updateBuilding, 
  deleteBuilding 
} from "../controllers/buildingController.js";

const router = express.Router();

// Create Building (auth required)
router.post("/", authMiddleware, createBuilding);

// Get Buildings
router.get("/", getBuildings);

// Get Building by ID
router.get("/:id", getBuildingById);

// Update Building (auth required)
router.put("/:id", authMiddleware, updateBuilding);

// Delete Building (auth required)
router.delete("/:id", authMiddleware, deleteBuilding);

export default router;
