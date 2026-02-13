import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Building from '../models/buildingModel.js';
import Client from '../models/clientModel.js';
import Invoice from '../models/invoiceModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const check = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const invoiceId = '698f149d13d03912ffe2ae4c';
        const inv = await Invoice.findById(invoiceId).populate('client').populate('building');

        if (!inv) {
            console.log('Invoice not found');
            return;
        }

        console.log('Invoice Status:', inv.status);
        console.log('Balance:', inv.balance);
        console.log('Due Date:', inv.due_date);

        console.log('\n--- Client Policy ---');
        console.log(JSON.stringify(inv.client?.lateFeePolicy, null, 2));

        console.log('\n--- Building Policy ---');
        console.log(JSON.stringify(inv.building?.lateFeePolicy, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
};

check();
