import express from "express";
import { 
  clientSignup, 
  adminLogin, 
  clientLogin, 
  memberLogin, 
  memberClientLogin,
  sendMemberClientOtp,
  verifyMemberClientOtp,
  communityLogin,
  communitySignup,
  onDemandUserSignup,
  onDemandUserLogin,
  getMe,
  refreshAccessToken,
  logout,
  logoutAllDevices
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

// Auth routes
// New routes
router.post("/client/register", clientSignup);
router.post("/client/login", clientLogin);
router.post("/admin/login", adminLogin);
router.post("/member/login", memberLogin);
router.post("/member-client/login", memberClientLogin); // Unified member/client login
router.post("/member-client/send-otp", sendMemberClientOtp); // Send OTP for member/client
router.post("/member-client/verify-otp", verifyMemberClientOtp); // Verify OTP for member/client
router.post("/community/register", communitySignup);
router.post("/community/login", communityLogin);
router.post("/ondemand/register", onDemandUserSignup);
router.post("/ondemand/login", onDemandUserLogin);

// Refresh token routes
router.post("/refresh", refreshAccessToken); // Refresh access token
router.post("/logout", logout); // Logout (revoke refresh token)
router.post("/logout-all", authMiddleware, logoutAllDevices); // Logout from all devices

// Backward-compatible aliases
router.post("/register", clientSignup);
router.post("/login", adminLogin);
router.get("/me", authMiddleware, getMe);

export default router;
