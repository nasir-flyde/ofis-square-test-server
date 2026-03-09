import express from "express";
import { signup, login, createTicket, getCategories } from "../controllers/docSupportController.js";
import docSupportAuth from "../middlewares/docSupportAuth.js";
import upload from "../middlewares/multer.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/categories", getCategories);
router.post("/tickets", docSupportAuth, upload.single("image"), createTicket);

export default router;
