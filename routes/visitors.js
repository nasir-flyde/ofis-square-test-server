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
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

// Public routes (for QR scanning at reception)
router.post("/scan", scanQRCode);

router.post("/", authMiddleware, uploadVisitorProfilePicture, handleUploadError, createVisitor);
router.get("/", authMiddleware, getVisitors);
router.get("/today", authMiddleware, getTodaysVisitors);
router.get("/stats", authMiddleware, getVisitorStats);
router.get("/pending-checkin", authMiddleware, getPendingCheckinRequests);
router.get("/:id", authMiddleware, getVisitorById);
// router.put("/:id", updateVisitor);                  
router.delete("/:id", authMiddleware, deleteVisitor);
router.patch("/:id/checkin", authMiddleware, checkinVisitor);
router.post("/request-checkin", uploadVisitorProfilePicture, handleUploadError, requestCheckinNew)
router.post("/request-checkin-new", uploadVisitorProfilePicture, handleUploadError, requestCheckinNew)
router.patch("/:id/checkout", authMiddleware, checkoutVisitor);
router.patch("/:id/cancel", authMiddleware, cancelVisitor);
router.post("/:id/request-checkin", requestCheckin);
router.post("/:id/approve-checkin", authMiddleware, approveCheckin);
router.patch("/:id/accept", authMiddleware, acceptVisitor);
router.patch("/:id/decline", authMiddleware, declineVisitor);

export default router;
