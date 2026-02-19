import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Building from './models/buildingModel.js';
import Client from './models/clientModel.js';
import Invoice from './models/invoiceModel.js';
import Contract from './models/contractModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const setup = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        // 1. Find an active building
        let building = await Building.findOne({ status: 'active' });
        if (!building) {
            console.log('No active building found, checking draft...');
            building = await Building.findOne({});
        }

        if (!building) {
            console.log('No building found at all. Cannot proceed.');
            return;
        }

        console.log(`Using Building: ${building.name} (${building._id})`);

        // 2. Enable Late Fee Policy for building
        building.lateFeePolicy = {
            enabled: true,
            gracePeriodDays: 0,
            variables: [{ name: 'daily_rate', value: 150, type: 'fixed', key: 'daily_rate' }]
        };
        await building.save();
        console.log('Building late fee policy enabled (150/day)');

        // 3. Find/Create a client
        let client = await Client.findOne({});
        if (!client) {
            console.log('No client found. Creating one...');
            client = await Client.create({
                companyName: 'Test Late Fee Client',
                email: 'test@example.com',
                phone: '1234567890',
                contactPerson: 'Test Person'
            });
        }
        console.log(`Using Client: ${client.companyName} (${client._id})`);

        // 4. Create an overdue invoice
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        const invoice = await Invoice.create({
            client: client._id,
            building: building._id,
            type: 'regular',
            status: 'overdue',
            invoice_number: 'TEST-LATE-' + Date.now().toString().slice(-4),
            date: fiveDaysAgo,
            due_date: fiveDaysAgo,
            total: 10000,
            balance: 10000,
            amount_paid: 0,
            sub_total: 10000,
            tax_total: 0,
            line_items: [{
                description: 'Rent for Test',
                quantity: 1,
                unitPrice: 10000,
                amount: 10000
            }]
        });

        console.log(`Created overdue invoice: ${invoice.invoice_number}`);
        console.log('\nSetup complete. Now run: node scripts/verifyDailyLateFee.js');

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
};

setup();
