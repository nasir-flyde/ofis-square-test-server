import express from "express";
import {
  createVisitor,
  getVisitors,
  getVisitorById,
  //   updateVisitor,
  deleteVisitor,
  checkinVisitor,
  checkoutVisitor,
  scanQRCode,
  cancelVisitor,
  getTodaysVisitors,
  getVisitorStats,
  markNoShows,
  requestCheckin,
  requestCheckinNew,
  approveCheckin,
  getPendingCheckinRequests,
  acceptVisitor,
  declineVisitor
} from "../controllers/visitorController.js";


import { uploadVisitorProfilePicture, handleUploadError } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

// Public routes (for QR scanning at reception)
router.post("/scan", scanQRCode);

router.post("/", uploadVisitorProfilePicture, handleUploadError, createVisitor);
router.get("/", getVisitors);
router.get("/today", getTodaysVisitors);
router.get("/stats", getVisitorStats);
router.get("/pending-checkin", getPendingCheckinRequests);
router.get("/:id", getVisitorById);
// router.put("/:id", updateVisitor);                  
router.delete("/:id", deleteVisitor);
router.patch("/:id/checkin", checkinVisitor);
router.post("/request-checkin", uploadVisitorProfilePicture, handleUploadError, requestCheckinNew)
router.post("/request-checkin-new", uploadVisitorProfilePicture, handleUploadError, requestCheckinNew)
router.patch("/:id/checkout", checkoutVisitor);
router.patch("/:id/cancel", cancelVisitor);
router.post("/:id/request-checkin", requestCheckin);
router.post("/:id/approve-checkin", approveCheckin);
router.patch("/:id/accept", acceptVisitor);
router.patch("/:id/decline", declineVisitor);

export default router;
