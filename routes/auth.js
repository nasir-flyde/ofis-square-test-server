import express from "express";
import { 
  clientSignup, 
  adminLogin, 
  clientLogin, 
  memberLogin, 
  communityLogin, 
  onDemandUserSignup,
  onDemandUserLogin,
  getMe 
} from "../controllers/authController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

// Auth routes
// New routes
router.post("/client/register", clientSignup);
router.post("/client/login", clientLogin);
router.post("/admin/login", adminLogin);
router.post("/member/login", memberLogin);
router.post("/community/login", communityLogin);
router.post("/ondemand/register", onDemandUserSignup);
router.post("/ondemand/login", onDemandUserLogin);

// Backward-compatible aliases
router.post("/register", clientSignup);
router.post("/login", adminLogin);
router.get("/me", authMiddleware, getMe);

export default router;
