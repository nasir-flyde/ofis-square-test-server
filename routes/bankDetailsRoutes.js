import express from 'express';
const router = express.Router();
import { getBankDetails } from '../controllers/bankDetailsController.js';

router.get('/', getBankDetails);

export default router;
