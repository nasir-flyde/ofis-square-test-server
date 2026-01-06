import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import universalMiddleware from '../middlewares/universalAuthVerify.js';
import communityMiddleware from "../middlewares/communityMiddleware.js";
import { uploadMeetingRoomImages, handleUploadError } from "../middlewares/uploadMiddleware.js";
import multer from "multer";
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
  getAvailableRoomsByTime,
  exportMasterFile,
  downloadSampleCSV,
  importMeetingRoomsFromCSV
} from "../controllers/meetingRoomController.js";

const router = express.Router();

// Multer for CSV upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Export master file and sample CSV (must be before /:id route)
router.get("/export/master", exportMasterFile);
router.get("/import/sample", downloadSampleCSV);
router.post("/import", authMiddleware, upload.single('file'), importMeetingRoomsFromCSV);

router.get("/", listRooms);
router.get("/available-by-time",getAvailableRoomsByTime);
router.post("/", authMiddleware, uploadMeetingRoomImages, handleUploadError, createRoom);
router.get("/:id", getRoomById);
router.patch("/:id", authMiddleware, uploadMeetingRoomImages, handleUploadError, updateRoom);
router.patch("/:id/availability", authMiddleware, updateAvailability);
router.delete("/:id", authMiddleware, deleteRoom);

// Time slot management routes
router.get("/:id/available-slots", getAvailableSlots);
router.post("/:id/reserved-slots", authMiddleware, addReservedSlot);
router.delete("/:id/reserved-slots", authMiddleware, removeReservedSlot);
router.patch("/:id/toggle-booking", authMiddleware, toggleBookingStatus);

export default router;
