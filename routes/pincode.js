import express from "express";
import { getLocationByPincode } from "../controllers/pincodeController.js";

const router = express.Router();

// GET /api/pincode/:pincode - Get location details by pincode
router.get("/:pincode", getLocationByPincode);

export default router;
