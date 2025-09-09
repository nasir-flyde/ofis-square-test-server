import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import apiRoutes from "./routes/api.js";
import crypto from "crypto";
import axios from "axios";
import { getIO, initSocket } from "./utils/socket.js";
import { scheduleNoShowUpdates } from "./utils/cronJobs.js";

// Load .env from this directory explicitly to be robust against different CWDs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") }); // 🔑 Load env variables

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

// Middlewares
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5001',
    'http://localhost:5173',
    'https://ofis-square-admin.vercel.app',
    'https://ofis-square-frontend.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
};

app.use(cors(corsOptions));
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

// Initialize cron jobs
scheduleNoShowUpdates();

// Start Server
const PORT = process.env.PORT || 5001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Ofis Square Server running on http://localhost:${PORT}`);
});
