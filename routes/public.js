import express from "express";
import { signupClient } from "../controllers/publicController.js";

const router = express.Router();

router.post("/signup", signupClient);

export default router;
