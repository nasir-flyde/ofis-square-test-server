import express from "express";
import { 
  sendOtpForLogin, 
  verifyOtpAndLogin, 
  resendOtp 
} from "../controllers/otpController.js";

const router = express.Router();

// OTP authentication routes
router.post("/send", sendOtpForLogin);
router.post("/verify", verifyOtpAndLogin);
router.post("/resend", resendOtp);

export default router;
