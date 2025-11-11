import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  getUsers,
  getStaffUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getInternalUsers
} from "../controllers/userController.js";

const router = express.Router();

router.get("/", authMiddleware, getUsers);
router.get("/internal", authMiddleware, getInternalUsers);
router.get("/staff",getStaffUsers);
router.get("/:id", getUserById);
router.post("/", authMiddleware, createUser);
router.put("/:id", updateUser);
router.delete("/:id", authMiddleware, deleteUser);

export default router;
