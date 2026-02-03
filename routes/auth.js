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
  logoutAllDevices,
  companyAccessLogin
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole } from "../middlewares/rbacMiddleware.js";

const router = express.Router();

// Auth routes
// New routes
router.post("/client/register", clientSignup);
router.post("/client/login", clientLogin);
router.post("/admin/login", adminLogin);
router.post("/member/login", memberLogin);
router.post("/member-client/login", memberClientLogin);
router.post("/member-client/send-otp", sendMemberClientOtp);
router.post("/member-client/verify-otp", verifyMemberClientOtp);
router.post("/community/register", communitySignup);
router.post("/community/login", communityLogin);
router.post("/ondemand/register", onDemandUserSignup);
router.post("/ondemand/login", onDemandUserLogin);
// Company Access login
router.post("/company-access/login", companyAccessLogin);

// Refresh token routes
router.post("/refresh", refreshAccessToken);
router.post("/logout", logout);
router.post("/logout-all", authMiddleware, logoutAllDevices);

// Backward-compatible aliases
router.post("/register", clientSignup);
router.post("/login", adminLogin);
router.get("/me", authMiddleware, populateUserRole, getMe);

export default router;
