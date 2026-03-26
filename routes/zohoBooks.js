import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  getTaxes,
  searchZohoContacts,
  getLocations,
  getChartOfAccounts
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

// GET /api/zoho-books/locations
router.get(
  "/locations",
  getLocations
);

// GET /api/zoho-books/chartofaccounts
router.get(
  "/chartofaccounts",
  getChartOfAccounts
);

export default router;
