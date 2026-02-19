import mongoose from 'mongoose';
import {
    createMonthlyEstimatesConsolidated,
    processApprovedEstimatesForSending,
    convertSentEstimatesToInvoices
} from '../services/monthlyInvoiceService.js';
import Client from '../models/clientModel.js';
import Building from '../models/buildingModel.js';
import Contract from '../models/contractModel.js';
import Invoice from '../models/invoiceModel.js';
import Estimate from '../models/estimateModel.js';

const MONGO_URI = 'mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-test';
const TEST_ID_SUFFIX = 'PIPELINE_TEST';

async function run() {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected.');

        await cleanup();

        console.log('Creating test data...');
        const building = await Building.create({
            name: `Building ${TEST_ID_SUFFIX}`,
            address: 'Test Address',
            city: 'Test City',
            draftInvoiceGeneration: true,
            draftInvoiceDay: 22,
            estimateSendDay: 26,
            invoiceSendDay: 1
        });

        const client = await Client.create({
            companyName: `Client ${TEST_ID_SUFFIX}`,
            contactPerson: 'Test Person',
            email: 'test_pipeline@example.com',
            phone: '9876543210'
        });

        const contract = await Contract.create({
            client: client._id,
            building: building._id,
            startDate: new Date('2026-01-01'),
            status: 'active',
            monthlyRent: 10000,
            contractNumber: `CN-${TEST_ID_SUFFIX}`
        });

        // --- STAGE 1: DRAFT (Run on Jan 22) ---
        console.log('\n--- Stage 1: Draft Generation (Jan 22) ---');
        const jan22 = new Date('2026-01-22T10:00:00Z');
        await createMonthlyEstimatesConsolidated(jan22);

        let estimate = await Estimate.findOne({ client: client._id, building: building._id });
        if (estimate && estimate.status === 'draft') {
            console.log('✅ PASS: Draft Estimate created.');
        } else {
            console.error('❌ FAIL: Draft Estimate not created or wrong status:', estimate?.status);
            return;
        }

        // --- STAGE 2: MANUAL APPROVAL (Simulated) ---
        console.log('\n--- Stage 2: Manual Approval (Simulated) ---');
        estimate.status = 'approved_internal';
        await estimate.save();
        console.log('✅ SUCCESS: Status updated to approved_internal.');

        // --- STAGE 3: SEND (Run on Jan 26) ---
        console.log('\n--- Stage 3: Auto-Send (Jan 26) ---');
        const jan26 = new Date('2026-01-26T10:00:00Z');
        await processApprovedEstimatesForSending(jan26);

        estimate = await Estimate.findById(estimate._id);
        if (estimate.status === 'sent') {
            console.log('✅ PASS: Estimate status updated to sent.');
        } else {
            console.error('❌ FAIL: Estimate status not sent:', estimate.status);
        }

        // --- STAGE 4: INVOICE (Run on Feb 1) ---
        console.log('\n--- Stage 4: Auto-Invoice (Feb 1) ---');
        const feb1 = new Date('2026-02-01T10:00:00Z');
        await convertSentEstimatesToInvoices(feb1);

        estimate = await Estimate.findById(estimate._id);
        const invoice = await Invoice.findOne({ client: client._id, building: building._id, category: 'monthly' });

        if (estimate.status === 'invoiced' && invoice) {
            console.log('✅ PASS: Estimate marked as invoiced and Invoice document created.');
            console.log('   Invoice ID:', invoice._id);
        } else {
            console.error('❌ FAIL: Invoice not created or estimate status wrong:', estimate.status);
        }

        await cleanup();
        console.log('\nPipeline Verification Complete.');

    } catch (err) {
        console.error('Execution Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

async function cleanup() {
    const clients = await Client.find({ companyName: `Client ${TEST_ID_SUFFIX}` });
    const clientIds = clients.map(c => c._id);
    const buildings = await Building.find({ name: `Building ${TEST_ID_SUFFIX}` });
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
