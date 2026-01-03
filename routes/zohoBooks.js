import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { getTaxes } from "../controllers/zohoBooksController.js";

const router = express.Router();

// GET /api/zoho-books/taxes
router.get(
  "/taxes",
  getTaxes
);

export default router;
