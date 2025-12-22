import express from "express";
import axios from 'axios';

const router = express.Router();

// Health check route
router.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Ofis Square API is running",
    timestamp: new Date().toISOString(),
    database: "Connected"
  });
});

// Returns the server's public egress IP
router.get('/egress-ip', async (req, res) => {
  try {
    const { data } = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
    res.json({ serverEgressIP: data.ip });
  } catch (e) {
    res.json({ serverEgressIP: 'unavailable', error: e.message });
  }
});

export default router;
