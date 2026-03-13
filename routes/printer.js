import express from "express";
import {
  createPrinterRequest,
  markAsReady,
  completeRequest,
  getPrinterRequests
} from "../controllers/printerController.js";
import authMiddleware from "../middlewares/universalAuthVerify.js";
import { kycUploads as upload } from "../middlewares/multer.js";

const router = express.Router();

// Role-based authorization helper
const authorize = (roles = []) => {
  return (req, res, next) => {
    const roleName = req.user?.roleName || req.userRole?.roleName;
    if (!roleName) return res.status(403).json({ message: "Access denied: No role found" });

    if (roles.length && !roles.includes(roleName)) {
      return res.status(403).json({ message: `Access denied: ${roleName} not authorized` });
    }
    next();
  };
};

// Public/Member routes (with token)
router.post("/upload", authMiddleware, upload, createPrinterRequest);
router.get("/my-requests", getPrinterRequests);

// Admin/Community routes
router.patch("/:id/ready", authMiddleware, markAsReady);
router.post("/:id/complete", authMiddleware, completeRequest);
router.get("/requests", authMiddleware, getPrinterRequests);

export default router;
