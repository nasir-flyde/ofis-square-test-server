import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import { listProvisioningJobs, retryProvisioningJob } from "../controllers/provisioningJobController.js";

const router = express.Router();

router.get("/", authMiddleware, populateUserRole, listProvisioningJobs);
router.post("/:id/retry", authMiddleware, populateUserRole, requireSystemAdmin, retryProvisioningJob);

export default router;
