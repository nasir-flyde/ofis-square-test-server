import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { uploadMeetingRoomImages, handleUploadError } from "../middlewares/uploadMiddleware.js";
import { 
  createRoom, 
  listRooms, 
  getRoomById, 
  updateRoom, 
  updateAvailability, 
  deleteRoom,
  getAvailableSlots,
  addReservedSlot,
  removeReservedSlot,
  toggleBookingStatus,
  getAvailableRoomsByTime
} from "../controllers/meetingRoomController.js";

const router = express.Router();

router.get("/", listRooms);
router.get("/available-by-time",getAvailableRoomsByTime);
router.post("/", authMiddleware, uploadMeetingRoomImages, handleUploadError, createRoom);
router.get("/:id", authMiddleware, communityMiddleware, getRoomById);
router.patch("/:id", authMiddleware, uploadMeetingRoomImages, handleUploadError, updateRoom);
router.patch("/:id/availability", authMiddleware, updateAvailability);
router.delete("/:id", authMiddleware, deleteRoom);

// Time slot management routes
router.get("/:id/available-slots", getAvailableSlots);
router.post("/:id/reserved-slots", authMiddleware, addReservedSlot);
router.delete("/:id/reserved-slots", authMiddleware, removeReservedSlot);
router.patch("/:id/toggle-booking", authMiddleware, toggleBookingStatus);

export default router;
