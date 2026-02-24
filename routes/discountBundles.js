import express from "express";
import {
    createDiscountBundle,
    getAllDiscountBundles,
    getDiscountBundleById,
    updateDiscountBundle,
    deleteDiscountBundle
} from "../controllers/discountBundleController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", authMiddleware, createDiscountBundle);
router.get("/", getAllDiscountBundles);
router.get("/:id", authMiddleware, getDiscountBundleById);
router.put("/:id", authMiddleware, updateDiscountBundle);
router.delete("/:id", authMiddleware, deleteDiscountBundle);

export default router;
