import express from 'express';
import {
  getApiLogs,
  getApiLogById,
  getApiStats,
  getRecentFailures,
  cleanupLogs,
  exportLogs,
  retryApiCall,
  getApiLogsHealth
} from '../controllers/apiLogsController.js';
import { adminMiddleware } from '../middlewares/authVerify.js';

const router = express.Router();

// Apply admin middleware to all routes
router.use(adminMiddleware);

// GET /api/api-logs - List API call logs with filtering and pagination
router.get('/', getApiLogs);

// GET /api/api-logs/stats - Get API call statistics
router.get('/stats', getApiStats);

// GET /api/api-logs/failures - Get recent failures
router.get('/failures', getRecentFailures);

// GET /api/api-logs/export - Export logs as CSV
router.get('/export', exportLogs);

// GET /api/api-logs/health - Health check for API logging system
router.get('/health', getApiLogsHealth);

// DELETE /api/api-logs/cleanup - Clean up old logs
router.delete('/cleanup', cleanupLogs);

// GET /api/api-logs/:id - Get specific API log
router.get('/:id', getApiLogById);

// POST /api/api-logs/retry/:id - Retry a failed API call
router.post('/retry/:id', retryApiCall);

export default router;
