import CreditTransaction from "../models/creditTransactionModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Invoice from "../models/invoiceModel.js";
import Building from "../models/buildingModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { createZohoInvoiceFromLocal } from "../utils/zohoBooks.js";
import mongoose from "mongoose";


function mapRefTypeToCategory(refType) {
  if (refType.startsWith('custom_item_')) {
    return 'custom_services';
  }

  const mapping = {
    'day_pass': 'day_pass',
    'meeting_booking': 'meeting_room',
    'printing': 'printing',
    'amenities': 'amenities',
    'admin_adjustment': 'general',
    'contract': 'general',
    'purchase': 'general',
    'refund': 'general',
    'expiry': 'general'
  };

  return mapping[refType] || 'other';
}

/**
 * Generate credit invoices for clients who exceeded their allocated credits
 * @param {number} year - Year (e.g., 2025)
 * @param {number} month - Month (1-12)
 * @returns {object} Summary of processed clients and invoices
 */
export async function generateMonthlyCreditInvoices(year, month) {
  console.log(`🔄 Starting credit consolidation for ${year}-${String(month).padStart(2, '0')}`);

  const results = {
    processed: 0,
    invoices_created: 0,
    invoices_skipped: 0,
    errors: [],
    summary: []
  };

  try {
    const billingStart = new Date(year, month - 1, 1);
    const billingEnd = new Date(year, month, 0);

    console.log(`📅 Billing period: ${billingStart.toISOString().slice(0, 10)} to ${billingEnd.toISOString().slice(0, 10)}`);

    const creditContracts = await Contract.find({
      credit_enabled: true,
      status: "active",
      $or: [
        { startDate: { $lte: billingEnd } },
        { endDate: { $gte: billingStart } }
      ]
    }).populate('client').populate('building');

    console.log(`👥 Found ${creditContracts.length} credit-enabled contracts`);

    for (const contract of creditContracts) {
      try {
        results.processed++;

        const clientId = contract.client._id;
        const clientName = contract.client.name || contract.client.companyName;

        console.log(`\n🔍 Processing client: ${clientName} (${clientId})`);

        // Calculate credit consumption for this month
        const creditUsage = await calculateMonthlyCreditsUsed(clientId, billingStart, billingEnd);
        const allocatedCredits = contract.allocated_credits || 0;
        const totalUsedCredits = creditUsage.total_credits;

        console.log(`📊 Credits - Allocated: ${allocatedCredits}, Used: ${totalUsedCredits}, Total Extra: ${Math.max(0, totalUsedCredits - allocatedCredits)}`);
        const categoryInvoices = [];
        let remainingAllocatedCredits = allocatedCredits;

        // Use traditional breakdown
        const combinedBreakdown = { ...creditUsage.breakdown };
        const building = contract.building || await Building.findById(contract.building);
        const creditValue = building?.creditValue || 500;

        // Process each category
        for (const [refType, breakdown] of Object.entries(combinedBreakdown)) {
          const category = mapRefTypeToCategory(refType);
          const categoryCredits = breakdown.credits;
          const existingInvoice = await Invoice.findOne({
            client: clientId,
            type: "credit_monthly",
            category: category,
            "billing_period.start": billingStart,
            "billing_period.end": billingEnd
          });

          if (existingInvoice) {
            console.log(`⏭️  Invoice already exists for ${clientName} - ${category}: ${existingInvoice.invoice_number}`);
            results.invoices_skipped++;
            continue;
          }

          // Calculate extra credits for this category
          let extraCreditsForCategory = 0;
          if (remainingAllocatedCredits > 0) {
            if (categoryCredits > remainingAllocatedCredits) {
              extraCreditsForCategory = categoryCredits - remainingAllocatedCredits;
              remainingAllocatedCredits = 0;
            } else {
              remainingAllocatedCredits -= categoryCredits;
            }
          } else {
            extraCreditsForCategory = categoryCredits;
          }

          if (extraCreditsForCategory > 0) {
            categoryInvoices.push({
              category,
              refType,
              categoryCredits,
              extraCredits: extraCreditsForCategory,
              breakdown
            });
          }
        }

        if (categoryInvoices.length === 0) {
          console.log(`✅ No extra credits to invoice for ${clientName}`);
          results.summary.push({
            client: clientName,
            allocated_credits: allocatedCredits,
            used_credits: totalUsedCredits,
            extra_credits: 0,
            invoice_amount: 0,
            status: "no_invoice_needed"
          });
          continue;
        }

        // Create separate invoices for each category with extra credits
        for (const categoryData of categoryInvoices) {
          const invoiceAmount = categoryData.extraCredits * creditValue;

          console.log(`💰 ${categoryData.category} invoice: ${categoryData.extraCredits} credits × ₹${creditValue} = ₹${invoiceAmount}`);
          const invoice = await createCreditInvoice({
            client: contract.client,
            contract,
            billingStart,
            billingEnd,
            category: categoryData.category,
            extraCredits: categoryData.extraCredits,
            creditValue,
            invoiceAmount,
            creditUsage: {
              breakdown: { [categoryData.refType]: categoryData.breakdown },
              total_credits: categoryData.categoryCredits
            },
            building
          });

          console.log(`✅ Created ${categoryData.category} invoice ${invoice.invoice_number} for ${clientName}: ₹${invoiceAmount}`);

          results.invoices_created++;
          results.summary.push({
            client: clientName,
            category: categoryData.category,
            allocated_credits: allocatedCredits,
            used_credits: categoryData.categoryCredits,
            extra_credits: categoryData.extraCredits,
            invoice_amount: invoiceAmount,
            invoice_number: invoice.invoice_number,
            status: "invoice_created"
          });

          // Try to push to Zoho Books if client is linked
          if (contract.client.zohoBooksContactId) {
            try {
              console.log(`🔄 Pushing ${categoryData.category} invoice ${invoice.invoice_number} to Zoho Books...`);
              await createZohoInvoiceFromLocal(invoice, contract.client);
              console.log(`✅ Successfully synced to Zoho Books`);
            } catch (zohoError) {
              console.error(`❌ Failed to sync to Zoho Books:`, zohoError.message);
              results.errors.push({
                client: clientName,
                invoice: invoice.invoice_number,
                category: categoryData.category,
                error: `Zoho sync failed: ${zohoError.message}`
              });
            }
          }
        }

      } catch (clientError) {
        console.error(`❌ Error processing client ${contract.client?.name}:`, clientError.message);
        results.errors.push({
          client: contract.client?.name || 'Unknown',
          error: clientError.message
        });
      }
    }

    console.log(`\n📋 Credit consolidation completed:`);
    console.log(`   • Clients processed: ${results.processed}`);
    console.log(`   • Invoices created: ${results.invoices_created}`);
    console.log(`   • Invoices skipped: ${results.invoices_skipped}`);
    console.log(`   • Errors: ${results.errors.length}`);

    return results;

  } catch (error) {
    console.error(`❌ Credit consolidation failed:`, error.message);
    throw error;
  }
}

/**
 * Calculate total credits consumed by a client in a given month
 */
async function calculateMonthlyCreditsUsed(clientId, startDate, endDate) {
  const transactions = await CreditTransaction.find({
    client: clientId,
    type: "consume",
    createdAt: { $gte: startDate, $lte: endDate }
  }).sort({ createdAt: 1 });

  const summary = {
    total_credits: 0,
    total_amount: 0,
    transactions: transactions.length,
    breakdown: {}
  };

  for (const transaction of transactions) {
    summary.total_credits += transaction.credits;
    summary.total_amount += (transaction.credits * transaction.valuePerCredit);

    // Group by refType for breakdown
    const refType = transaction.refType || 'other';
    if (!summary.breakdown[refType]) {
      summary.breakdown[refType] = { credits: 0, amount: 0, count: 0 };
    }
    summary.breakdown[refType].credits += transaction.credits;
    summary.breakdown[refType].amount += (transaction.credits * transaction.valuePerCredit);
    summary.breakdown[refType].count++;
  }

  return summary;
}

/**
 * Create a credit invoice for extra credits used
 */
async function createCreditInvoice({ client, contract, billingStart, billingEnd, category = 'general', extraCredits, creditValue, invoiceAmount, creditUsage, building = null }) {
  const invoiceNumber = await generateLocalInvoiceNumber();
  const monthName = billingStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Create line items from usage breakdown
  const lineItems = [];

  // Main line item for extra credits with category
  const categoryLabel = category.replace('_', ' ').toUpperCase();
  lineItems.push({
    description: `Extra ${categoryLabel} Credits - ${monthName}`,
    name: `Extra ${categoryLabel} Credits - ${monthName}`,
    quantity: extraCredits,
    rate: creditValue,
    unitPrice: creditValue,
    amount: invoiceAmount,
    item_total: invoiceAmount,
    unit: "credits",
    tax_name: "GST",
    tax_percentage: 18, // 18% GST on services
  });

  // Add breakdown as additional line items (for reference, with 0 amount)
  for (const [refType, breakdown] of Object.entries(creditUsage.breakdown)) {
    if (breakdown.credits > 0) {
      lineItems.push({
        description: `  └ ${refType.replace('_', ' ').toUpperCase()}: ${breakdown.credits} credits`,
        name: `${refType} usage`,
        quantity: breakdown.credits,
        rate: 0, // Reference only
        unitPrice: 0,
        amount: 0,
        item_total: 0,
        unit: "credits"
      });
    }
  }
  const taxableAmount = invoiceAmount;
  const taxRate = 18; // 18% GST
  const taxAmount = Math.round(taxableAmount * (taxRate / 100) * 100) / 100;
  const totalAmount = invoiceAmount + taxAmount;

  // Create invoice
  const invoice = await Invoice.create({
    invoice_number: invoiceNumber,
    client: client._id,
    contract: contract._id,
    building: contract.building,
    type: "credit_monthly",
    category: category,
    source: "local",

    date: new Date(new Date().toDateString()),
    due_date: (() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 2);
    })(),
    billing_period: {
      start: billingStart,
      end: billingEnd
    },

    line_items: lineItems,
    sub_total: invoiceAmount,
    tax_total: taxAmount,
    total: totalAmount,
    amount_paid: 0,
    balance: totalAmount,

    status: "draft",
    notes: `Monthly credit invoice for ${extraCredits} extra credits consumed in ${monthName}. Allocated: ${contract.allocated_credits} credits, Used: ${creditUsage.total_credits} credits.`,

    // Zoho Books fields
    currency_code: "INR",
    exchange_rate: 1,
    gst_treatment: "business_gst",
    place_of_supply: "MH",
    payment_terms: contract.credit_terms_days || 30,
    payment_terms_label: `Net ${contract.credit_terms_days || 30}`,
    is_inclusive_tax: false
  });

  return invoice;
}


/**
 * Run consolidation for previous month (typically called on 1st of each month)
 */
export async function runPreviousMonthConsolidation() {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();

  return await generateMonthlyCreditInvoices(year, month);
}

export default {
  generateMonthlyCreditInvoices,
  runPreviousMonthConsolidation
};
