import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import apiRoutes from "./routes/api.js";
import crypto from "crypto";
import axios from "axios";
import { getIO, initSocket } from "./utils/socket.js";

dotenv.config(); // 🔑 Load env variables

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

// Middlewares
app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

// MongoDB Connection using .env
mongoose
  .connect(process.env.MONGODB_URI || "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/test")
  .then(() => console.log("✅ MongoDB Connected DB"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

app.get("/", (req, res) => {
  res.send("✅ Ofis Square Backend is working!");
});

// Start Server
const PORT = process.env.PORT || 5001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Ofis Square Server running on http://localhost:${PORT}`);
});
