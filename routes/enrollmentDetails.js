import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole } from "../middlewares/rbacMiddleware.js";
import { listEnrollmentDetails } from "../controllers/enrollmentDetailController.js";

const router = express.Router();

// List enrollment details (enroll objects)
router.get("/", authMiddleware, populateUserRole, listEnrollmentDetails);

export default router;
