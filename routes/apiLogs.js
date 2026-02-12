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
import authMiddleware from '../middlewares/authVerify.js';

const router = express.Router();

router.use(authMiddleware);
router.get('/', getApiLogs);
router.get('/stats', getApiStats);
router.get('/failures', getRecentFailures);
router.get('/export', exportLogs);
router.get('/health', getApiLogsHealth);
router.delete('/cleanup', cleanupLogs);
router.get('/:id', getApiLogById);
router.post('/retry/:id', retryApiCall);

export default router;
