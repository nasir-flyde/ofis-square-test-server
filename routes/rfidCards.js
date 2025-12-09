import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin } from "../middlewares/rbacMiddleware.js";
import {
  listRFIDCards,
  createRFIDCard,
  getRFIDCardById,
  assignMemberToCard,
  activateRFIDCard,
  suspendRFIDCard,
  revokeRFIDCard,
  markLostRFIDCard,
  replaceRFIDCard,
} from "../controllers/rfidCardController.js";

const router = express.Router();

router.get("/", authMiddleware, populateUserRole, listRFIDCards);
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createRFIDCard);
router.get("/:id", authMiddleware, populateUserRole, getRFIDCardById);

router.post("/:id/assign-member", authMiddleware, populateUserRole, requireSystemAdmin, assignMemberToCard);
router.post("/:id/activate", authMiddleware, populateUserRole, requireSystemAdmin, activateRFIDCard);
router.post("/:id/suspend", authMiddleware, populateUserRole, requireSystemAdmin, suspendRFIDCard);
router.post("/:id/revoke", authMiddleware, populateUserRole, requireSystemAdmin, revokeRFIDCard);
router.post("/:id/lost", authMiddleware, populateUserRole, requireSystemAdmin, markLostRFIDCard);
router.post("/:id/replace", authMiddleware, populateUserRole, requireSystemAdmin, replaceRFIDCard);

export default router;
