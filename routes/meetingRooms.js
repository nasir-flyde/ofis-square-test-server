import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { createRoom, listRooms, getRoomById, updateRoom, updateAvailability, deleteRoom } from "../controllers/meetingRoomController.js";

const router = express.Router();

router.get("/", authMiddleware, listRooms);
router.post("/", authMiddleware, createRoom);
router.get("/:id", authMiddleware, getRoomById);
router.patch("/:id", authMiddleware, updateRoom);
router.patch("/:id/availability", authMiddleware, updateAvailability);
router.delete("/:id", authMiddleware, deleteRoom);

export default router;
