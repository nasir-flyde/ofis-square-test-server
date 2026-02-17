import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  getTaxes,
  searchZohoContacts
} from "../controllers/zohoBooksController.js";

const router = express.Router();

// GET /api/zoho-books/taxes
router.get(
  "/taxes",
  getTaxes
);

// GET /api/zoho-books/contacts/search
router.get(
  "/contacts/search",
  authMiddleware,
  searchZohoContacts
);

export default router;
