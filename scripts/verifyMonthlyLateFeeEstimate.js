import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateMonthlyLateFeeEstimates } from '../services/lateFeeService.js';
import Estimate from '../models/estimateModel.js';
import LateFee from '../models/lateFeeModel.js';
import Building from '../models/buildingModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        // Force a building to have today as draftInvoiceDay (TEMPORARY for testing if needed)
        // or just assume we have one matching building or mock it
        const today = new Date();
        const day = today.getDate();

        // Check if any building matches
        const count = await Building.countDocuments({ draftInvoiceGeneration: true, draftInvoiceDay: day });
        console.log(`Buildings scheduled for today (${day}): ${count}`);

        if (count === 0) {
            console.log('No buildings scheduled for today. Skipping manual run.');
            // Optional: find one and log it
        } else {
            console.log('Running generateMonthlyLateFeeEstimates...');
            const result = await generateMonthlyLateFeeEstimates();
            console.log('Result:', result);

            // Check generated estimates
            if (result.created > 0) {
                const recentEstimates = await Estimate.find({
                    notes: /Consolidated Last Minute Fees/
                })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .populate('client', 'companyName');

                console.log('\nRecent Late Fee Estimates:');
                recentEstimates.forEach(e => {
                    console.log(`- Est#: ${e.estimate_number || 'draft'} | Total: ${e.total} | Client: ${e.client?.companyName}`);
                });
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
};

run();
