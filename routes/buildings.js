import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { createBuilding, getBuildings } from "../controllers/buildingController.js";

const router = express.Router();

// Create Building (auth required)
router.post("/", authMiddleware, createBuilding);

// Get Buildings
router.get("/", getBuildings);

export default router;
