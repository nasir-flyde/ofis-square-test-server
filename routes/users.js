import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  getUsers,
  getStaffUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
} from "../controllers/userController.js";

const router = express.Router();

router.get("/", authMiddleware, getUsers);
router.get("/staff", authMiddleware, getStaffUsers);
router.get("/:id", authMiddleware, getUserById);
router.post("/", authMiddleware, createUser);
router.put("/:id", authMiddleware, updateUser);
router.delete("/:id", authMiddleware, deleteUser);

export default router;
