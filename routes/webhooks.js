import express from "express";
import { 
  handleZohoSignWebhook, 
  webhookHealthCheck, 
  testWebhook 
} from "../controllers/zohoWebhookController.js";
import { 
  handleZohoBooksWebhook, 
  zohoBooksWebhookHealthCheck, 
  testZohoBooksWebhook 
} from "../controllers/zohoBooksWebhookController.js";

const router = express.Router();

/**
 * Zoho Sign Webhook Routes
 * These routes handle incoming webhook events from Zoho Sign
 */

// Main Zoho Sign webhook endpoint
// This is the URL you should configure in Zoho Sign webhook settings
router.post("/zoho-sign", handleZohoSignWebhook);

// Health check endpoint for webhook monitoring
router.get("/health", webhookHealthCheck);

// Test endpoint for development (only available in non-production)
router.post("/test", testWebhook);

// Alternative webhook endpoint paths (for flexibility)
router.post("/zoho-sign/events", handleZohoSignWebhook);
router.post("/zoho/sign", handleZohoSignWebhook);

// Zoho Books Webhook Routes
router.post("/zoho-books", handleZohoBooksWebhook);
router.get("/zoho-books/health", zohoBooksWebhookHealthCheck);
router.post("/zoho-books/test", testZohoBooksWebhook);
router.post("/zoho-books/events", handleZohoBooksWebhook);
router.post("/zoho/books", handleZohoBooksWebhook);

export default router;
