import express from "express";
import { clientSignup, adminLogin, clientLogin, memberLogin, getMe } from "../controllers/authController.js";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole } from "../middlewares/rbacMiddleware.js";

const router = express.Router();

// Auth routes
// New routes
router.post("/client/register", clientSignup);
router.post("/client/login", clientLogin);
router.post("/admin/login", adminLogin);
router.post("/member/login", memberLogin);

// Backward-compatible aliases
router.post("/register", clientSignup);
router.post("/login", adminLogin);
router.get("/me", authMiddleware, populateUserRole, getMe);

export default router;
