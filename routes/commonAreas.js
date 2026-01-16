import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  listCommonAreas,
  createCommonArea,
  getCommonAreaById,
  updateCommonArea,
  deleteCommonArea,
} from "../controllers/commonAreaController.js";

const router = express.Router();

// List common areas (filters: buildingId, status, areaType, q)
router.get("/", listCommonAreas);

// Create a common area
router.post("/", authMiddleware, createCommonArea);

// Get by ID
router.get("/:id", getCommonAreaById);

// Update
router.put("/:id", authMiddleware, updateCommonArea);
router.patch("/:id", authMiddleware, updateCommonArea);

// Delete
router.delete("/:id", authMiddleware, deleteCommonArea);

export default router;
