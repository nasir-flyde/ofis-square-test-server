import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { populateUserRole, requireSystemAdmin, requirePermission } from "../middlewares/rbacMiddleware.js";
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
  assignClientToCard,
  assignMemberToCardByCompany,
  downloadSampleCSV,
  importRFIDCardsFromCSV,
} from "../controllers/rfidCardController.js";
import multer from "multer";

const router = express.Router();

// Multer for CSV upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// CSV import routes must appear before any /:id routes
router.get("/import/sample", authMiddleware, populateUserRole, requireSystemAdmin, downloadSampleCSV);
router.post("/import", authMiddleware, populateUserRole, requireSystemAdmin, upload.single('file'), importRFIDCardsFromCSV);

router.get("/", authMiddleware, populateUserRole, listRFIDCards);
router.post("/", authMiddleware, populateUserRole, requireSystemAdmin, createRFIDCard);
router.get("/:id", authMiddleware, populateUserRole, getRFIDCardById);

router.post("/:id/assign-member", authMiddleware, populateUserRole, requireSystemAdmin, assignMemberToCard);
// Community assigns card to client (community role bypasses permission in middleware); others need rfid:assign:client
router.post(
  "/:id/assign-client",
  authMiddleware,
  populateUserRole,
  requirePermission("rfid:assign:client"),
  assignClientToCard
);
// Company access user (owner) assigns to member within same client
router.post(
  "/:id/assign-member/company",
  authMiddleware,
  populateUserRole,
  requirePermission("rfid:assign:member"),
  assignMemberToCardByCompany
);
router.post("/:id/activate", authMiddleware, populateUserRole, requireSystemAdmin, activateRFIDCard);
router.post("/:id/suspend", authMiddleware, populateUserRole, requireSystemAdmin, suspendRFIDCard);
router.post("/:id/revoke", authMiddleware, populateUserRole, requireSystemAdmin, revokeRFIDCard);
router.post("/:id/lost", authMiddleware, populateUserRole, requireSystemAdmin, markLostRFIDCard);
router.post("/:id/replace", authMiddleware, populateUserRole, requireSystemAdmin, replaceRFIDCard);

export default router;
