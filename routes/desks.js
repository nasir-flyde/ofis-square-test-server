import express from "express";
import authMiddleware from "../middlewares/authVerify.js";
import { getDesks, createDesk, allocateDesk, releaseDesk } from "../controllers/deskController.js";

const router = express.Router();

router.get("/", authMiddleware, getDesks);
router.post("/", authMiddleware, createDesk);
router.post("/allocate", authMiddleware, allocateDesk);
router.post("/:id/release", authMiddleware, releaseDesk);

export default router;
