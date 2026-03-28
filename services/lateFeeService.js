import Contract from "../models/contractModel.js";
import Invoice from "../models/invoiceModel.js";
import LateFee from "../models/lateFeeModel.js";
import Estimate from "../models/estimateModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";

// Helper: Calculate late fee for a single day based on policy
const evaluateDailyLateFee = (invoice, policy) => {
    if (!policy || !policy.enabled) return 0;

    // Calculate overdue days
    const dueDate = new Date(invoice.due_date);
    const now = new Date();

    // Reset times to compare dates only
    const d1 = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffTime = d2 - d1;
    const overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // If explicitly within grace period, no fee (though usually this function is called for overdue)
    const grace = Number(policy.gracePeriodDays || 0);
    if (overdueDays <= grace) return 0;

    // Logic from old system (or simplified daily logic)
    // Default: some fixed amount or percentage. 
    // For daily recording, we typically want the "per day" amount.

    // If custom formula exists, evaluate it (simplified for now, assume standard logic if not)
    // NOTE: If your policy says "10% of invoice", that's usually a one-time fee or per month.
    // If it's "100 Rs per day", that's easy.

    // Let's assume the policy has a 'rate' or we use a standard fallback.
    // Ideally, the policy object should tell us the daily rate.
    // For now, I will implement a placeholder standard logic or try to use what's in the policy.

    // If policy has variables, try to find a daily rate
    let dailyAmount = 0;

    if (policy.customFormula) {
        // If complex formula, we might need a safer eval or specific logic.
        // For this implementation, let's look for a simple "daily_rate" or "percentage_per_annum"
        // fallback: 
    }

    // Fallback Logic from previous system usually had:
    // 1. Fixed daily amount
    // 2. Percentage of outstanding balance (per day? or one-time?)

    // Let's assume a standard logic if not defined:
    // e.g., 500 INR/day or 2% per month (~0.06% per day)

    // Based on previous code analysis (which I can't restart looking at now), 
    // let's try to interpret policy.variables

    /* 
       Previous code used `evaluateLateFeeAmount` which handled:
       - Fixed amount
       - Percentage (of balance)
       - Per day vs Flat
    */

    // Validating what we have in DB usually:
    // variable: { name: 'Daily Rate', value: 100, type: 'fixed' }
    // or { name: 'Interest', value: 18, type: 'percentage_pa' }

    // Let's implement a robust default:
    // If variables has 'daily_rate', use it.
    // If variables has 'annual_interest', calculate daily interest.

    let variables = policy.variables || [];

    if (Array.isArray(variables)) {
        // Check for explicit daily fixed amount in Array format
        const dailyVar = variables.find(v => v.name?.toLowerCase().includes('daily') || v.key === 'daily_rate' || v.key === 'rate');
        if (dailyVar) {
            dailyAmount = Number(dailyVar.value || 0);
        } else {
            // Check for percentage (assume per annum usually, or per month)
            const pctVar = variables.find(v => v.type === 'percentage');
            if (pctVar) {
                const balance = invoice.balance || 0;
                const pct = Number(pctVar.value || 0);
                dailyAmount = (balance * pct / 100) / 30;
            }
        }
    } else if (typeof variables === 'object') {
        // Handle Object format (e.g. { rate: 2 })
        dailyAmount = Number(variables.daily_rate || variables.rate || 0);
    }

    // Hard fallback if policy is enabled but no calc found:
    if (dailyAmount === 0 && policy.enabled) {
        dailyAmount = 0; // Better safe than charging unknown
    }

    return Math.round(dailyAmount * 100) / 100;
};

/**
 * Format building bank details for invoice notes
 */
function formatBankDetails(building, isProForma = false) {
    const bank = building?.bankDetails;
    if (!bank || !bank.accountNumber) return "";

    const cityName = building.city?.name || "Noida";
    const disclaimer = isProForma ? "\nThis is not a tax invoice. " : "\n";

    return `\n\nCompany's Bank Details\n` +
        `A/c Holder's Name: ${bank.accountHolderName}\n` +
        `Bank Name: ${bank.bankName}\n` +
        `A/c No.: ${bank.accountNumber}\n` +
        `Branch : ${bank.branchName}\n` +
        `IFS Code: ${bank.ifscCode}\n` +
        `${disclaimer}Subject to ${cityName} jurisdiction only.`;
}

// 1. Record Daily Late Fees
export const recordDailyLateFees = async () => {
    console.log('[Cron] Starting Daily Late Fee Recording...');
    const results = { recorded: 0, errors: 0, skipped: 0 };

    try {
        const today = new Date();
        // Normalize to midnight
        const dateStr = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        // Find all active invoices that are overdue and have a balance > 0
        // We only care about 'regular' invoices (rent), not other late fees or deposits usually.
        // Also, status should be 'sent' or 'partially_paid' or 'overdue'
        // 'draft' invoices aren't late.

        const overdueInvoices = await Invoice.find({
            status: { $in: ['draft', 'sent', 'partially_paid', 'overdue', 'issued'] },
            balance: { $gt: 0 },
            due_date: { $lt: today }, // Strictly past due
            type: 'regular' // Only apply to regular invoices
        })
            .populate('client')
            .populate('building')
            .populate('contract');

        for (const inv of overdueInvoices) {
            try {
                if (!inv.client || !inv.building) continue;

                // Resolve Policy (Client override > Building default)
                // Check Client specific policy first
                let policy = inv.client.lateFeePolicy;

                // If client policy not enabled/set, fallback to building
                if (!policy || !policy.enabled) {
                    policy = inv.building.lateFeePolicy;
                }

                // If still no policy or not enabled, skip
                if (!policy || !policy.enabled) {
                    results.skipped++;
                    continue;
                }

                // Check if fee already recorded for today for this invoice
                const exists = await LateFee.exists({
                    original_invoice: inv._id,
                    date: dateStr
                });

                if (exists) {
                    results.skipped++;
                    continue;
                }

                // Evaluate Amount
                const amount = evaluateDailyLateFee(inv, policy);

                if (amount > 0) {
                    await LateFee.create({
                        client: inv.client._id,
                        contract: inv.contract?._id, // might be null if not linked
                        building: inv.building._id,
                        original_invoice: inv._id,
                        date: dateStr,
                        amount: amount,
                        status: 'pending'
                    });
                    results.recorded++;
                } else {
                    results.skipped++;
                }

            } catch (err) {
                console.error(`Error processing invoice ${inv._id} for late fee:`, err);
                results.errors++;
            }
        }

    } catch (error) {
        console.error('Fatal error in recordDailyLateFees:', error);
    }

    console.log(`[Cron] Daily Late Fee Recording Completed. Recorded: ${results.recorded}, Skipped: ${results.skipped}, Errors: ${results.errors}`);
    return results;
};


// 2. Generate Consolidated Late Fee Estimates
export const generateMonthlyLateFeeEstimates = async () => {
    console.log('[Cron] Starting Monthly Late Fee Estimate Generation...');
    const results = { created: 0, errors: 0 };

    try {
        const today = new Date();
        const currentDay = today.getDate();

        // Find buildings scheduled for draft generation TODAY
        const buildings = await Building.find({
            draftInvoiceGeneration: true,
            draftInvoiceDay: currentDay
        }).populate('lateFeeItem');

        for (const building of buildings) {
            // Find all PENDING late fees for this building
            const pendingFees = await LateFee.find({
                building: building._id,
                status: 'pending'
            }).populate('client');

            if (pendingFees.length === 0) continue;

            const feesByClient = new Map();

            for (const fee of pendingFees) {
                const clientId = String(fee.client._id);
                if (!feesByClient.has(clientId)) {
                    feesByClient.set(clientId, { client: fee.client, fees: [] });
                }
                feesByClient.get(clientId).fees.push(fee);
            }

            for (const [clientId, data] of feesByClient.entries()) {
                try {
                    const { client, fees } = data;

                    const totalAmount = fees.reduce((sum, f) => sum + f.amount, 0);

                    const feesByInvoice = new Map();
                    for (const fee of fees) {
                        const invId = String(fee.original_invoice);
                        if (!feesByInvoice.has(invId)) {
                            feesByInvoice.set(invId, { count: 0, total: 0, ids: [] });
                        }
                        const entry = feesByInvoice.get(invId);
                        entry.count++;
                        entry.total += fee.amount;
                        entry.ids.push(fee._id);
                    }

                    const lineItems = [];
                    const allFeeIds = [];

                    for (const [invId, stat] of feesByInvoice.entries()) {
                        const invDetails = await Invoice.findById(invId).select('invoice_number');
                        const invNum = invDetails ? invDetails.invoice_number : 'Unknown';

                        lineItems.push({
                            description: `Accumulated Late Fees for Invoice ${invNum} (${stat.count} days)`,
                            quantity: 1,
                            unitPrice: stat.total,
                            amount: stat.total,
                            name: 'Late Fee',
                            rate: stat.total,
                            unit: 'nos',
                            item_total: stat.total,
                            item_id: building.lateFeeItem?.zoho_item_id || undefined
                        });

                        allFeeIds.push(...stat.ids);
                    }

                    const taxRate = 18;
                    const taxTotal = Math.round(totalAmount * (taxRate / 100) * 100) / 100;
                    const finalTotal = Math.round((totalAmount + taxTotal) * 100) / 100;

                    const billingPeriodStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    const billingPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

                    const estimate = await Estimate.create({
                        client: client._id,
                        building: building._id,
                        date: today,
                        expiry_date: new Date(today.getFullYear(), today.getMonth() + 1, building.draftInvoiceDueDay || 7),
                        billing_period: { start: billingPeriodStart, end: billingPeriodEnd },
                        line_items: lineItems,
                        sub_total: Math.round(totalAmount * 100) / 100,
                        tax_total: taxTotal,
                        total: finalTotal,
                        status: 'draft',
                        notes: `Consolidated Last Minute Fees / Overdue Charges${formatBankDetails(building)}`,
                        zoho_tax_id: building.zoho_tax_id,
                        zoho_books_location_id: building.zoho_books_location_id,
                        currency_code: 'INR',
                        exchange_rate: 1,
                        gst_treatment: 'business_gst',
                        place_of_supply: building?.place_of_supply || 'MH',
                        ...(client.billingAddress && {
                            billing_address: {
                                attention: client.contactPerson,
                                address: client.billingAddress.address,
                                city: client.billingAddress.city,
                                state: client.billingAddress.state,
                                zip: client.billingAddress.zip,
                                country: client.billingAddress.country || 'IN',
                                phone: client.phone
                            }
                        }),
                        customer_id: client.zohoBooksContactId,
                        gst_no: client.gstNo
                    });

                    await LateFee.updateMany(
                        { _id: { $in: allFeeIds } },
                        {
                            $set: {
                                status: 'billed',
                                billed_in_estimate: estimate._id,
                                billed_at: new Date()
                            }
                        }
                    );

                    results.created++;

                    if (client.zohoBooksContactId) {
                        try {
                            const { createZohoEstimateFromLocal } = await import('../utils/zohoBooks.js');
                            const estObj = estimate.toObject();
                            if (building.zoho_books_location_id) estObj.zoho_books_location_id = building.zoho_books_location_id;
                            if (building.zoho_tax_id) estObj.zoho_tax_id = building.zoho_tax_id;
                            
                            const zohoResp = await createZohoEstimateFromLocal(estObj, client.toObject());

                            if (zohoResp?.estimate?.estimate_id) {
                                estimate.zoho_estimate_id = zohoResp.estimate.estimate_id;
                                estimate.estimate_number = zohoResp.estimate.estimate_number;
                                await estimate.save();
                                console.log(`[LateFeeEstimate] Pushed to Zoho: ${zohoResp.estimate.estimate_number}`);
                            }
                        } catch (zohoErr) {
                            console.error(`[LateFeeEstimate] Zoho push error for client ${clientId}:`, zohoErr?.message || zohoErr);
                        }
                    }

                } catch (clientErr) {
                    console.error(`Error generating late fee estimate for client ${clientId}:`, clientErr);
                    results.errors++;
                }
            }
        }

    } catch (error) {
        console.error('Fatal error in generateMonthlyLateFeeEstimates:', error);
    }

    console.log(`[Cron] Monthly Late Fee Estimate Generation Completed. Created: ${results.created}, Errors: ${results.errors}`);
    return results;
};
