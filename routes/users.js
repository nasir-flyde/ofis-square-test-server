import express from "express";
import authVerify from "../middlewares/authVerify.js";
import checkPermission from "../middlewares/checkPermission.js";
import {
  getUsers,
  getUserById,
  deleteUser
} from "../controllers/userController.js";

const router = express.Router();

// Get all users with optional filters
router.get("/", authVerify, getUsers);

// Get user by ID
router.get("/:id", authVerify, getUserById);

// Delete user (admin only)
router.delete("/:id", authVerify, checkPermission("admin"), deleteUser);

export default router;
