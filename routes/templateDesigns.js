import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
    listDesigns,
    getDesignById,
    createDesign,
    updateDesign,
    deleteDesign,
} from "../controllers/templateDesignController.js";

const router = express.Router();

router.get("/", authMiddleware, listDesigns);
router.get("/:id", authMiddleware, getDesignById);
router.post("/", authMiddleware, createDesign);
router.put("/:id", authMiddleware, updateDesign);
router.delete("/:id", authMiddleware, deleteDesign);

export default router;
