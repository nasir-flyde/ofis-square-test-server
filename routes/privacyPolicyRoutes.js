import express from "express";
import {
    createPrivacyPolicy,
    getPrivacyPolicies,
    getPrivacyPolicyById,
    updatePrivacyPolicy,
    deletePrivacyPolicy
} from "../controllers/privacyPolicyController.js";
import { authVerify } from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", authVerify, createPrivacyPolicy);
router.get("/", getPrivacyPolicies);
router.get("/:id", getPrivacyPolicyById);
router.put("/:id", authVerify, updatePrivacyPolicy);
router.delete("/:id", authVerify, deletePrivacyPolicy);

export default router;
