import express from "express";
import { createCity, getCities, getCityById, updateCity, deleteCity } from "../controllers/cityController.js";

const router = express.Router();

router.post("/", createCity);
router.get("/", getCities);
router.get("/:id", getCityById);
router.put("/:id", updateCity);
router.delete("/:id", deleteCity);

export default router;
