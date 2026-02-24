import express from "express";
import {
    createPrivacyPolicy,
    getPrivacyPolicies,
    getPrivacyPolicyById,
    updatePrivacyPolicy,
    deletePrivacyPolicy
} from "../controllers/privacyPolicyController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", authMiddleware, createPrivacyPolicy);
router.get("/", getPrivacyPolicies);
router.get("/:id", getPrivacyPolicyById);
router.put("/:id", authMiddleware, updatePrivacyPolicy);
router.delete("/:id", authMiddleware, deletePrivacyPolicy);

export default router;
