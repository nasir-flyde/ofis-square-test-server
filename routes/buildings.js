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

// Get Building Day Pass Pricing
router.get("/:id/daypass-pricing", (req, res) => {
  // Simple endpoint to get building's openSpacePricing
  getBuildingById(req, res);
});

// Update Building (auth required)
router.put("/:id", authMiddleware, updateBuilding);

// Update Building Day Pass Pricing (auth required)
router.put("/:id/daypass-pricing", authMiddleware, async (req, res) => {
  try {
    const { openSpacePricing } = req.body;
    
    if (openSpacePricing === undefined) {
      return res.status(400).json({ error: "openSpacePricing is required" });
    }

    if (openSpacePricing < 0) {
      return res.status(400).json({ error: "openSpacePricing must be non-negative" });
    }

    // Use the existing updateBuilding controller with pricing data
    req.body = { openSpacePricing };
    updateBuilding(req, res);
  } catch (error) {
    console.error("Update building pricing error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete Building (auth required)
router.delete("/:id", authMiddleware, deleteBuilding);

export default router;
