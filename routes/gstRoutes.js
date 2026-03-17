import express from "express";
import { validateGST } from "../controllers/gstController.js";

const router = express.Router();

router.post("/validate", validateGST);
router.get("/validate", validateGST);

export default router;
