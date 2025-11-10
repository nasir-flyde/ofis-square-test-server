import express from "express";
import {
  getAllTickets,
  createTicket,
  getTicketById,
  updateTicket,
  deleteTicket,
  getTicketStats,
  getStaffTickets,
  getTicketsByMember,
} from "../controllers/ticketController.js";
import authMiddleware from "../middlewares/authVerify.js";
import universalAuthMiddleware from "../middlewares/universalAuthVerify.js";
import upload from "../middlewares/multer.js";

const router = express.Router();

router.get("/", getAllTickets);
router.post("/", upload.array('images', 5), createTicket);
router.get("/stats", getTicketStats);
router.get("/staff/:userId", getStaffTickets);
router.get("/member/my-tickets", universalAuthMiddleware, getTicketsByMember); 
router.get("/member/:memberId", universalAuthMiddleware, getTicketsByMember);
router.get("/:id", getTicketById);
router.patch("/:id", updateTicket);
router.delete("/:id", authMiddleware, deleteTicket);

export default router;
