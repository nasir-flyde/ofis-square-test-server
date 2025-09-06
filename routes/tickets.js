import express from "express";
import {
  getAllTickets,
  createTicket,
  getTicketById,
  updateTicket,
  deleteTicket,
  getTicketStats,
  getStaffTickets,
} from "../controllers/ticketController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.get("/", getAllTickets);
router.post("/", createTicket);
router.get("/stats", getTicketStats);
router.get("/staff/:userId", getStaffTickets);
router.get("/:id", getTicketById);
router.patch("/:id", authMiddleware, updateTicket);
router.delete("/:id", authMiddleware, deleteTicket);

export default router;
