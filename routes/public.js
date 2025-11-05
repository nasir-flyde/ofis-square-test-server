import express from "express";
import { signupClient } from "../controllers/publicController.js";

const router = express.Router();

// Public signup endpoint - no authentication required
router.post("/signup", signupClient);

export default router;
