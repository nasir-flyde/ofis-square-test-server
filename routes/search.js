import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireAnyPermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import { globalSearch } from "../controllers/searchController.js";

const router = express.Router();

// Allow access if user has any relevant read permission
const SEARCH_PERMISSIONS = [
  PERMISSIONS.CLIENT_READ,
  PERMISSIONS.MEMBER_READ,
  PERMISSIONS.INVENTORY_READ,
  PERMISSIONS.BOOKING_READ,
  PERMISSIONS.INVOICE_READ,
  PERMISSIONS.PAYMENT_READ,
  PERMISSIONS.REPORT_READ,
];

router.get(
  "/",
  authMiddleware,
  globalSearch
);

export default router;
