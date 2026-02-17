import express from 'express';
import {
    saveClientStep,
    saveDocumentsStep,
    saveContractStep,
    saveCabinStep,
    saveMembersStep,
    saveFinancialsStep,
    getMigrationStatus
} from '../controllers/migrationController.js';
import authMiddleware from '../middlewares/authVerify.js';
import { kycUploads } from '../middlewares/multer.js';

const router = express.Router();

router.post('/step-1-client', authMiddleware, saveClientStep);
router.post('/step-2-documents', authMiddleware, kycUploads, saveDocumentsStep);
router.post('/step-3-contract', authMiddleware, kycUploads, saveContractStep);
router.post('/step-4-cabin', authMiddleware, saveCabinStep);
router.post('/step-5-members', authMiddleware, saveMembersStep);
router.post('/step-6-financials', authMiddleware, saveFinancialsStep);
router.get('/status', authMiddleware, getMigrationStatus);

export default router;
