import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
} from "../controllers/notificationCategoryController.js";

const router = express.Router();

// GET all categories
router.get("/", getAllCategories);

// GET category by ID
router.get("/:id", authMiddleware, getCategoryById);

// POST create new category (Typically Superadmin/Admin restrict if needed)
router.post("/", authMiddleware, createCategory);

// PUT update category
router.put("/:id", authMiddleware, updateCategory);

// DELETE category
router.delete("/:id", authMiddleware, deleteCategory);

export default router;
