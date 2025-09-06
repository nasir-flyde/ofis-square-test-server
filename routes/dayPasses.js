import express from "express";
import { createDayPass } from "../controllers/dayPassController.js";

const router = express.Router();

// POST /api/day-passes
router.post("/", createDayPass);

export default router;
