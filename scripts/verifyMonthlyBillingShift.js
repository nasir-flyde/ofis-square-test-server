import mongoose from 'mongoose';
import { createMonthlyInvoices, createMonthlyEstimatesConsolidated } from '../services/monthlyInvoiceService.js';
import Client from '../models/clientModel.js';
import Building from '../models/buildingModel.js';
import Contract from '../models/contractModel.js';
import Invoice from '../models/invoiceModel.js';
import Estimate from '../models/estimateModel.js';

// Connection String from ofis-square .env
const MONGO_URI = 'mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-test';

const TEST_ID_SUFFIX = 'BILLSHIFT_TEST';

async function run() {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected.');

        // --- Cleanup prev run ---
        await cleanup();

        // --- Setup Test Data ---
        console.log('Creating test data...');
        const building = await Building.create({
            name: `Test Building ${TEST_ID_SUFFIX}`,
            address: 'Test Address',
            draftInvoiceGeneration: true,
            draftInvoiceDay: 25,
            draftInvoiceDueDay: 7
        });

        const client = await Client.create({
            companyName: `Test Client ${TEST_ID_SUFFIX}`,
            contactPerson: 'Test Person',
            email: 'test_billing_shift@example.com',
            phone: '9999999999'
        });

        // Contract starting Jan 15, 2026. 
        const contract = await Contract.create({
            client: client._id,
            building: building._id,
            startDate: new Date('2026-01-15'), // Starts mid-Jan
            endDate: new Date('2026-12-31'),
            status: 'active',
            monthlyRent: 50000,
            contractNumber: `CN-${TEST_ID_SUFFIX}`,
            agreementDate: new Date('2026-01-01')
        });

        console.log(`Created Contract: ${contract._id}`);

        // ==========================================
        // TEST SECTION: INVOICES
        // ==========================================
        console.log('\n=== INVOICE TESTS ===');

        // --- TEST 1: Run on Jan 25, 2026 ---
        // Target: Feb 2026.
        // Contract starts Jan 15. Feb is 2nd month.
        // Expect: CREATE.
        console.log('\n--- Test 1 (Invoice): Run on Jan 25, 2026 ---');
        const jan25 = new Date('2026-01-25T10:00:00Z');
        await createMonthlyInvoices(jan25);

        const invoiceFeb = await Invoice.findOne({
            contract: contract._id,
            'billing_period.start': new Date('2026-02-01'),
            'billing_period.end': new Date('2026-02-28')
        });

        if (invoiceFeb) {
            console.log('✅ PASS: Invoice created for Feb 2026.');
        } else {
            console.error('❌ FAIL: Invoice NOT created for Feb 2026.');
        }

        // --- TEST 2: Run on Dec 25, 2025 ---
        // Target: Jan 2026.
        // Contract starts Jan 15 (Mid-Month).
        // Expect: SKIP.
        console.log('\n--- Test 2 (Invoice): Run on Dec 25, 2025 ---');
        const dec25 = new Date('2025-12-25T10:00:00Z');
        await createMonthlyInvoices(dec25);

        const invoiceJan = await Invoice.findOne({
            contract: contract._id,
            'billing_period.start': new Date('2026-01-01')
        });

        if (!invoiceJan) {
            console.log('✅ PASS: Invoice correctly skipped for Jan 2026.');
        } else {
            console.error('❌ FAIL: Invoice created for Jan 2026 (Should SKIP).');
            console.log(`   Invoice ID: ${invoiceJan._id}`);
        }

        // ==========================================
        // TEST SECTION: ESTIMATES (Consolidated)
        // ==========================================
        console.log('\n=== ESTIMATE TESTS ===');

        // Cleanup Invoices/Estimates for clean slate (optional, but good for isolation)
        await Invoice.deleteMany({ contract: contract._id });
        await Estimate.deleteMany({ client: client._id });

        // --- TEST 3: Estimate Run on Jan 25, 2026 ---
        // Target: Feb 2026.
        // Expect: CREATE.
        console.log('\n--- Test 3 (Estimate): Run on Jan 25, 2026 ---');
        await createMonthlyEstimatesConsolidated(jan25);

        const estFeb = await Estimate.findOne({
            client: client._id,
            'billing_period.start': new Date('2026-02-01'),
            'billing_period.end': new Date('2026-02-28')
        });

        if (estFeb) {
            console.log('✅ PASS: Estimate created for Feb 2026.');
        } else {
            console.error('❌ FAIL: Estimate NOT created for Feb 2026.');
        }

        // --- TEST 4: Estimate Run on Dec 25, 2025 ---
        // Target: Jan 2026.
        // Expect: SKIP (Mid-Month Start).
        console.log('\n--- Test 4 (Estimate): Run on Dec 25, 2025 ---');
        await createMonthlyEstimatesConsolidated(dec25);

        const estJan = await Estimate.findOne({
            client: client._id,
            'billing_period.start': new Date('2026-01-01')
        });

        if (!estJan) {
            console.log('✅ PASS: Estimate correctly skipped for Jan 2026.');
        } else {
            console.error('❌ FAIL: Estimate created for Jan 2026 (Should SKIP).');
            console.log('   Estimate ID:', estJan._id);
        }

        // Cleanup
        console.log('\nCleaning up...');
        await cleanup();
        console.log('Done.');

    } catch (err) {
        console.error('Global Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

async function cleanup() {
    const clients = await Client.find({ companyName: `Test Client ${TEST_ID_SUFFIX}` });
    const clientIds = clients.map(c => c._id);
    const buildings = await Building.find({ name: `Test Building ${TEST_ID_SUFFIX}` });
    const buildingIds = buildings.map(b => b._id);

    if (clientIds.length > 0) {
        await Contract.deleteMany({ client: { $in: clientIds } });
        await Invoice.deleteMany({ client: { $in: clientIds } });
        await Estimate.deleteMany({ client: { $in: clientIds } });
        await Client.deleteMany({ _id: { $in: clientIds } });
    }
    if (buildingIds.length > 0) {
        await Building.deleteMany({ _id: { $in: buildingIds } });
    }
}

run();
