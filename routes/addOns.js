import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requirePermission } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../constants/permissions.js";
import {
  getAllMasterAddOns,
  getAllContractAddOns,
  addAddOnToContract,
  removeAddOnFromContract,
  updateAddOnInContract,
  createMasterAddOn,
  updateMasterAddOn,
} from "../controllers/addOnController.js";

const router = express.Router();

// All routes are protected and require contract update permission
router.use(authMiddleware);
router.use(populateUserRole);

router.get("/all", getAllContractAddOns);
router.get("/master", getAllMasterAddOns);
router.post("/master", requirePermission(PERMISSIONS.INTEGRATION_UPDATE), createMasterAddOn);
router.put("/master/:id", requirePermission(PERMISSIONS.INTEGRATION_UPDATE), updateMasterAddOn);
router.post("/contract/:contractId", requirePermission(PERMISSIONS.CONTRACT_UPDATE), addAddOnToContract);
router.put("/contract/:contractId/:addonIndex", requirePermission(PERMISSIONS.CONTRACT_UPDATE), updateAddOnInContract);
router.delete("/contract/:contractId/:addonIndex", requirePermission(PERMISSIONS.CONTRACT_UPDATE), removeAddOnFromContract);

export default router;
