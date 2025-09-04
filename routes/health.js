import express from "express";

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

export default router;
