import express from "express";
import { listDocumentEntities, createDocumentEntity, updateDocumentEntity, deleteDocumentEntity } from "../controllers/documentEntityController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

// Public or auth-protected? Keep public for now; can add auth if needed.
router.get("/", listDocumentEntities);

// Management endpoints (protected)
router.post("/", authMiddleware, createDocumentEntity);
router.put("/:id", authMiddleware, updateDocumentEntity);
router.delete("/:id", authMiddleware, deleteDocumentEntity);

export default router;
