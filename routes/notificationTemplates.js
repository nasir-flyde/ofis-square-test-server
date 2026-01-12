import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
  listTemplates,
  getTemplateById,
  getTemplateByKeyRoute,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
} from "../controllers/notificationTemplateController.js";

const router = express.Router();

// List and read
router.get("/", authMiddleware, listTemplates);
router.get("/key/:key", authMiddleware, getTemplateByKeyRoute);
router.get("/:id", authMiddleware, getTemplateById);

// Create/Update/Delete
router.post("/", authMiddleware, createTemplate);
router.put("/:id", authMiddleware, updateTemplate);
router.delete("/:id", authMiddleware, deleteTemplate);

// Preview rendering
router.post("/preview", authMiddleware, previewTemplate);

export default router;
