import express from "express";
import {
  createTicketCategory,
  getAllTicketCategories,
  getTicketCategoryById,
  updateTicketCategory,
  deleteTicketCategory,
} from "../controllers/ticketCategoryController.js";

const router = express.Router();

router.post("/", createTicketCategory);
router.get("/", getAllTicketCategories);
router.get("/:id", getTicketCategoryById);
router.patch("/:id", updateTicketCategory);
router.delete("/:id", deleteTicketCategory);

export default router;
