import express from "express";
import {
    createTermsAndConditions,
    getTermsAndConditions,
    getTermsAndConditionsById,
    updateTermsAndConditions,
    deleteTermsAndConditions
} from "../controllers/termsAndConditionsController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", authMiddleware, createTermsAndConditions);
router.get("/", getTermsAndConditions);
router.get("/:id", getTermsAndConditionsById);
router.put("/:id", authMiddleware, updateTermsAndConditions);
router.delete("/:id", authMiddleware, deleteTermsAndConditions);

export default router;
