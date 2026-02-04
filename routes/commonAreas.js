import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  listCommonAreas,
  createCommonArea,
  getCommonAreaById,
  updateCommonArea,
  deleteCommonArea,
  exportMasterFileCommonAreas,
  downloadSampleCSVCommonAreas,
  importCommonAreasFromCSV,
} from "../controllers/commonAreaController.js";
import multer from "multer";

const router = express.Router();

// Multer for CSV upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Export master file
router.get("/export/master", exportMasterFileCommonAreas);

// CSV Import: sample download and import endpoint
router.get("/import/sample", downloadSampleCSVCommonAreas);
router.post("/import", authMiddleware, upload.single('file'), importCommonAreasFromCSV);

// List common areas (filters: buildingId, status, areaType, q)
router.get("/", listCommonAreas);

// Create a common area
router.post("/", authMiddleware, createCommonArea);

// Get by ID
router.get("/:id", getCommonAreaById);

// Update
router.put("/:id", authMiddleware, updateCommonArea);
router.patch("/:id", authMiddleware, updateCommonArea);

// Delete
router.delete("/:id", authMiddleware, deleteCommonArea);

export default router;
