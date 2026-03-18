import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  getCabins,
  createCabin,
  getCabinById,
  updateCabin,
  deleteCabin,
  allocateCabin,
  releaseCabin,
  getAvailableCabinsByBuilding,
  exportMasterFile,
  blockCabin,
  releaseCabinBlock,
  releaseAllBlocks,
  listCabinBlocks,
  allocateCabinFromBlock,
  importCabinsFromCSV,
  downloadSampleCSV,
  exportCabins
} from "../controllers/cabinController.js";
import multer from "multer";

const router = express.Router();

// Multer for CSV upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Export master file (must be before /:id route)
// Export cabins
router.get("/export", exportCabins);
router.get("/export/master", exportMasterFile);

// CSV Import: sample download and import endpoint
router.get("/import/sample", downloadSampleCSV);
router.post("/import", authMiddleware, upload.single('file'), importCabinsFromCSV);

// List Cabins (filters: building, floor, status, type)
router.get("/", getCabins);

// Create Cabin/Desk
router.post("/", authMiddleware, createCabin);

// Get Cabin by ID
router.get("/:id", getCabinById);
router.put("/:id", authMiddleware, updateCabin);
router.delete("/:id", authMiddleware, deleteCabin);
router.post("/allocate", authMiddleware, allocateCabin);
router.post("/:id/release", authMiddleware, releaseCabin);
router.get("/building/:buildingId/available", getAvailableCabinsByBuilding);

// Cabin blocking APIs
router.post("/:id/block", authMiddleware, blockCabin);
router.get("/:id/blocks", authMiddleware, listCabinBlocks);
router.post("/:id/blocks/release-all", authMiddleware, releaseAllBlocks);
router.post("/:id/blocks/:blockId/release", authMiddleware, releaseCabinBlock);
router.post("/:id/blocks/:blockId/allocate", authMiddleware, allocateCabinFromBlock);

export default router;
