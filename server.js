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
import { scheduleNoShowUpdates, scheduleMonthlyInvoices } from './utils/cronJobs.js';
import { initializeScheduler } from "./utils/scheduler.js";
import notificationScheduler from "./services/notifications/scheduler.js";
import activityLogMiddleware from "./middlewares/activityLogMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

const corsOptions = {
  origin: [
    'http://localhost:5174',
    'http://localhost:3000',
    'https://ofis-square-client.vercel.app',
    'https://ofis-square-client-git-backup-nasir-flydes-projects.vercel.app',
    'https://ofis-square-community.vercel.app',
    'http://localhost:5173',
    'http://localhost:5175',
    'https://ofis-square-admin.vercel.app',
    'https://ofis-square-frontend.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Activity logging middleware disabled: using manual controller logging only
// If you want to re-enable automatic logging, uncomment the block below.
// app.use(activityLogMiddleware({
//   skipRoutes: ['/health', '/status', '/ping', '/api/tickets'],
//   skipMethods: ['OPTIONS'],
//   logReadOperations: false, // Set to true if you want to log GET requests
//   logFailedRequests: true
// }));

app.use("/api", apiRoutes);

// Serve static files for uploaded photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose
  .connect(process.env.MONGODB_URI || "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/test")
  .then(() => console.log("✅ MongoDB Connected DB"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

app.get("/", (req, res) => {
  res.send("✅ Ofis Square Backend is working!");
});

scheduleNoShowUpdates();
scheduleMonthlyInvoices();
initializeScheduler();
// Start notifications scheduler (checks every minute)
notificationScheduler.start();

const PORT = process.env.PORT || 5001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Ofis Square Server running on http://localhost:${PORT}`);
});
