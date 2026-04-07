import express from "express";
const router = express.Router();
import { createSDPayment, getSDPayments, deleteSDPayment } from "../controllers/securityDepositPaymentController.js";
import authMiddleware from "../middlewares/authVerify.js";
import upload from "../middlewares/multer.js";

// All routes require authentication
router.use(authMiddleware);

router.post(
  "/",
  upload.fields([{ name: "images", maxCount: 5 }]),
  createSDPayment
);

router.get("/", getSDPayments);

router.delete("/:id", deleteSDPayment);

export default router;
