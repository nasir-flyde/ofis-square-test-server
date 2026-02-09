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
router.post("/zoho-sign", handleZohoSignWebhook);

// Health check endpoint for webhook monitoring
router.get("/health", webhookHealthCheck);
router.post("/test", testWebhook);
router.post("/zoho-sign/events", handleZohoSignWebhook);
router.post("/zoho/sign", handleZohoSignWebhook);
router.post("/zoho-books", handleZohoBooksWebhook);
router.get("/zoho-books/health", zohoBooksWebhookHealthCheck);
router.post("/zoho-books/test", testZohoBooksWebhook);
router.post("/zoho-books/events", handleZohoBooksWebhook);
router.post("/zoho/books", handleZohoBooksWebhook);

export default router;
