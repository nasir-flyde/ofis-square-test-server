import express from "express";
import {
  createAppRequest,
  getAllAppRequests,
} from "../controllers/appRequestController.js";

const router = express.Router();

router.post("/", createAppRequest);
router.get("/", getAllAppRequests);

export default router;
