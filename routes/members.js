import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  createMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember
} from "../controllers/memberController.js";

const router = express.Router();


router.post("/", createMember);
router.get("/",getMembers);
router.get("/:id", authMiddleware, getMemberById);
router.put("/:id", authMiddleware, updateMember);
router.delete("/:id", authMiddleware, deleteMember);

export default router;
