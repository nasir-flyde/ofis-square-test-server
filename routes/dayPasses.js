import express from "express";
import {
  createSingleDayPass,
  inviteVisitor,
  checkInWithQR,
  checkOutWithQR,
  scanQR,
  getUserDayPasses,
  getDayPassDetails,
  getAllDayPasses
} from "../controllers/dayPassController.js";
import {
  createDayPassBundle,
  getUserBundles,
  getBundleDetails,
  cancelBundle,
  getAllBundles
} from "../controllers/dayPassBundleController.js";
import authMiddleware from "../middlewares/authVerify.js";
import hostMiddleware from "../middlewares/hostMiddleware.js";

const router = express.Router();

// Single Day Pass Routes
router.post("/single",createSingleDayPass);
// Require a valid JWT so hostMiddleware can infer host (member/client/guest)
router.post("/:dayPassId/invite", hostMiddleware, inviteVisitor);
router.get("/user/:customerId", getUserDayPasses);
router.get("/:dayPassId", getDayPassDetails);

// Bundle Routes
router.post("/bundles", createDayPassBundle);
router.get("/bundles/user/:customerId", getUserBundles);
router.get("/bundles/:bundleId", getBundleDetails);
router.put("/bundles/:bundleId/cancel", cancelBundle);

// Check-in/Check-out Routes (Public - for front desk)
router.post("/checkin", checkInWithQR);
router.post("/checkout", checkOutWithQR);
router.post("/scan", scanQR);

// Admin Routes
router.get("/", getAllDayPasses);
router.get("/bundles", getAllBundles);

export default router;
