import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordDailyLateFees } from '../services/lateFeeService.js';
import Invoice from '../models/invoiceModel.js';
import LateFee from '../models/lateFeeModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        // 1. Manually trigger the daily job
        console.log('Running recordDailyLateFees...');
        const result = await recordDailyLateFees();
        console.log('Result:', result);

        // 2. Query LateFee to see what was created
        const today = new Date();
        const dateStr = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        const fees = await LateFee.find({ date: dateStr })
            .populate('client', 'companyName contactPerson')
            .populate('original_invoice', 'invoice_number balance due_date');

        console.log(`\nFound ${fees.length} late fee records for today:`);
        fees.forEach(f => {
            console.log(`- Amount: ${f.amount} | Inv: ${f.original_invoice?.invoice_number} | Client: ${f.client?.companyName || f.client?.contactPerson}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
};

run();
