import express from "express";
import buildingAmenityController from "../controllers/buildingAmenityController.js";

const router = express.Router();

router.get("/", buildingAmenityController.getBuildingAmenities);
router.get("/:id", buildingAmenityController.getBuildingAmenity);
router.post("/", buildingAmenityController.createBuildingAmenity);
router.put("/:id", buildingAmenityController.updateBuildingAmenity);
router.delete("/:id", buildingAmenityController.deleteBuildingAmenity);

export default router;
