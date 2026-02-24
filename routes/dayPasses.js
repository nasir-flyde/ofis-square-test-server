import express from "express";
import {
  createSingleDayPass,
  inviteVisitor,
  checkInWithQR,
  checkOutWithQR,
  scanQR,
  getUserDayPasses,
  getDayPassDetails,
  getAllDayPasses,
  updateVisitorDraft,
  issueDayPassManual,
  getAvailability,
  cancelDayPass,
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

router.post("/single", authMiddleware, createSingleDayPass);
router.post("/:dayPassId/invite", hostMiddleware, inviteVisitor);
router.patch("/:dayPassId/visitor-draft", updateVisitorDraft);
router.post("/:dayPassId/issue", issueDayPassManual);
router.get("/user/:customerId", getUserDayPasses);
router.get("/:dayPassId", getDayPassDetails);
router.put("/:id/cancel", authMiddleware, cancelDayPass);

// Bundle Routes
router.post("/bundles", authMiddleware, createDayPassBundle);
router.get("/bundles/user/:customerId", getUserBundles);
router.get("/bundles/:bundleId", getBundleDetails);
router.put("/bundles/:bundleId/cancel", cancelBundle);

// Availability
router.get("/availability", getAvailability);

router.post("/checkin", checkInWithQR);
router.post("/checkout", checkOutWithQR);
router.post("/scan", scanQR);
router.get("/", getAllDayPasses);
router.get("/bundles", getAllBundles);

export default router;
