import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { uploadMeetingRoomImages, handleUploadError } from "../middlewares/uploadMiddleware.js";
import { createRoom, listRooms, getRoomById, updateRoom, updateAvailability, deleteRoom } from "../controllers/meetingRoomController.js";

const router = express.Router();

router.get("/", listRooms);
router.post("/", authMiddleware, uploadMeetingRoomImages, handleUploadError, createRoom);
router.get("/:id", authMiddleware,communityMiddleware, getRoomById);
router.patch("/:id", authMiddleware, uploadMeetingRoomImages, handleUploadError, updateRoom);
router.patch("/:id/availability", authMiddleware, updateAvailability);
router.delete("/:id", authMiddleware, deleteRoom);

export default router;
