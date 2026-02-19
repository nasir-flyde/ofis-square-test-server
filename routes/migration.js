import express from 'express';
import {
    saveClientStep,
    saveDocumentsStep,
    saveContractStep,
    saveCabinStep,
    saveMembersStep,
    saveFinancialsStep,
    getMigrationStatus,
    bulkImportMigration,
    getBulkImportSampleCSV,
    bulkImportInvoicesAndPayments,
    getBulkFinancialsSampleCSV,
    getBulkMembersSampleCSV,
    bulkImportMembers,
    listPendingMigrations
} from '../controllers/migrationController.js';
import authMiddleware from '../middlewares/authVerify.js';
import upload, { kycUploads } from '../middlewares/multer.js';

const router = express.Router();

router.post('/step-1-client', authMiddleware, saveClientStep);
router.post('/step-2-documents', authMiddleware, kycUploads, saveDocumentsStep);
router.post('/step-3-contract', authMiddleware, kycUploads, saveContractStep);
router.post('/step-4-cabin', authMiddleware, saveCabinStep);
router.post('/step-5-members', authMiddleware, saveMembersStep);
router.post('/step-6-financials', authMiddleware, saveFinancialsStep);
router.get('/status', authMiddleware, getMigrationStatus);
router.post('/bulk-import', authMiddleware, bulkImportMigration);
router.get('/bulk-import/sample-csv', authMiddleware, getBulkImportSampleCSV);
router.post('/bulk-financials', authMiddleware, bulkImportInvoicesAndPayments);
router.get('/bulk-financials/sample-csv', getBulkFinancialsSampleCSV);
router.post('/bulk-members', authMiddleware, upload.single('file'), bulkImportMembers);
router.get('/pending', authMiddleware, listPendingMigrations);
router.get('/bulk-members/sample-csv', getBulkMembersSampleCSV);

export default router;
