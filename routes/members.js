import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember,
  getMemberProfile
} from "../controllers/memberController.js";

const router = express.Router();


router.post("/", createMember);
router.get("/",getMembers);
router.get("/profile", universalAuthMiddleware, getMemberProfile); // Get own profile from JWT
router.get("/:id", authMiddleware, getMemberById);
router.get("/:id/profile", authMiddleware, getMemberProfile); // Get specific member profile
router.put("/:id", authMiddleware, updateMember);
router.delete("/:id", authMiddleware, deleteMember);

export default router;
