import express from "express";
import authVerify from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember
} from "../controllers/memberController.js";

const router = express.Router();

// Create member (admin only)
router.post("/", authVerify, checkPermission("admin"), createMember);

// Get all members with filters
router.get("/", authVerify, getMembers);

// Get member by ID
router.get("/:id", authVerify, getMemberById);

// Update member (admin only)
router.put("/:id", authVerify, checkPermission("admin"), updateMember);

// Delete member (admin only)
router.delete("/:id", authVerify, checkPermission("admin"), deleteMember);

export default router;
