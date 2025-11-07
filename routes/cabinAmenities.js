import express from "express";
import {
  getCabinAmenities,
  getCabinAmenityById,
  createCabinAmenity,
  updateCabinAmenity,
  deleteCabinAmenity,
} from "../controllers/cabinAmenityController.js";

const router = express.Router();

router.get("/", getCabinAmenities);
router.get("/:id", getCabinAmenityById);
router.post("/", createCabinAmenity);
router.put("/:id", updateCabinAmenity);
router.delete("/:id", deleteCabinAmenity);

export default router;
