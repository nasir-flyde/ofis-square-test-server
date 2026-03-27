import Invoice from "../models/invoiceModel.js";
import Estimate from "../models/estimateModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Cabin from "../models/cabinModel.js";
import City from "../models/cityModel.js";
import AddOn from "../models/addOnModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { sendNotification } from "../utils/notificationHelper.js";

export const createMonthlyInvoices = async (refDate = new Date()) => {
  const results = { created: 0, errors: 0, details: [] };

  try {
    const now = refDate;

    // Get all active contracts
    const activeContracts = await Contract.find({
      status: 'active',
      startDate: { $lte: new Date() },
      $or: [
        { endDate: { $gte: new Date() } },
        { endDate: null }
      ]
    })
      .populate({
        path: "client",
        select: "companyName contactPerson email phone gstNo zohoBooksContactId billingAddress shippingAddress place_of_supply"
      })
      // Include building-level invoice scheduling fields, bank details and city for jurisdiction
      .populate({
        path: "building",
        select: "name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay lateFeePolicy bankDetails place_of_supply zoho_books_location_id city zoho_monthly_payment_item_id zoho_tax_id",
        populate: { path: "city", select: "name" }
      })
      .populate("addOns.addonId");

    console.log(`Found ${activeContracts.length} active contracts for monthly billing`);

    for (const contract of activeContracts) {
      try {
        const building = contract.building;
        if (!building) {
          results.details.push({ contractId: contract._id, status: 'skipped', reason: 'No building populated' });
          continue;
        }

        const { shouldGenerateToday, issueDate, dueDate } = getInvoiceScheduleForBuilding(building, now);
        if (!shouldGenerateToday) {
          results.details.push({ contractId: contract._id, status: 'skipped', reason: 'Not scheduled today for this building' });
          continue;
        }

        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const billingPeriodStart = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
        const billingPeriodEnd = new Date(Date.UTC(currentYear, currentMonth + 2, 0));

        const inv = await createMonthlyInvoiceForContract(contract, { issueDate, dueDate, billingPeriodStart, billingPeriodEnd, refDate: now });
        if (inv) {
          results.created++;
          results.details.push({
            contractId: contract._id,
            status: 'success',
            clientName: contract.client.companyName || contract.client.contactPerson || 'Client',
            buildingName: building.name,
            invoiceNumber: inv.invoice_number,
            amount: inv.total
          });
        }
      } catch (error) {
        console.error(`Error creating monthly invoice for contract ${contract._id}:`, error);
        results.errors++;
        results.details.push({
          contractId: contract._id,
          status: 'error',
          error: error.message
        });
      }
    }

    if (results.created > 0) {
      await notifyAdminsOfInvoiceBatch(results, 'generated');
    }

    console.log(`Monthly invoice generation completed: ${results.created} created, ${results.errors} errors`);
    return results;

  } catch (error) {
    console.error("Error in monthly invoice generation:", error);
    throw error;
  }
};

function getInvoiceScheduleForBuilding(building, now = new Date()) {
  // Determine configured issue and due days
  const defaultIssueDay = 25;
  const defaultDueDay = 7;
  const useCustom = !!building.draftInvoiceGeneration;
  const issueDayConfigured = useCustom && typeof building.draftInvoiceDay === 'number' ? building.draftInvoiceDay : defaultIssueDay;
  const dueDayConfigured = useCustom && typeof building.draftInvoiceDueDay === 'number' ? building.draftInvoiceDueDay : defaultDueDay;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const lastDayOfCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Normalize to valid day in month (e.g., 31 -> 30/28 based on month)
  const normalizedIssueDay = Math.min(Math.max(1, issueDayConfigured), lastDayOfCurrentMonth);
  const shouldGenerateToday = now.getDate() === normalizedIssueDay;

  const issueDate = new Date(Date.UTC(currentYear, currentMonth, normalizedIssueDay));

  // Due date on the configured day of the NEXT month
  const nextMonth = currentMonth + 1;
  const lastDayOfNextMonth = new Date(currentYear, nextMonth + 1, 0).getDate();
  const normalizedDueDay = Math.min(Math.max(1, dueDayConfigured), lastDayOfNextMonth);
  const dueDate = new Date(Date.UTC(currentYear, nextMonth, normalizedDueDay));

  return { shouldGenerateToday, issueDate, dueDate };
}


/**
 * Create a monthly invoice for a specific contract
 */
async function createMonthlyInvoiceForContract(contract, { issueDate, dueDate, billingPeriodStart, billingPeriodEnd, refDate } = {}) {
  const now = refDate || new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Determine billing period: passed args OR default to next month (aligned with shift)
  // If not passed, we default to next month to be safe for manual calls that want "upcoming" billing
  const periodStart = billingPeriodStart || new Date(Date.UTC(currentYear, currentMonth + 1, 1));
  const periodEnd = billingPeriodEnd || new Date(Date.UTC(currentYear, currentMonth + 2, 0));

  // Check if invoice already exists for this period
  const existingInvoice = await Invoice.findOne({
    contract: contract._id,
    "billing_period.start": periodStart,
    "billing_period.end": periodEnd
  });

  // If an invoice already exists for this period, return it
  if (existingInvoice) {
    return existingInvoice;
  }

  // Output billing period start for logging
  // billingPeriodStart and billingPeriodEnd are available from arguments/defaults

  // Skip if this is the first month and contract started mid-month (already has prorated invoice)
  // Use billing period month/year for comparison
  const contractStartDate = new Date(contract.startDate);
  const bpMonth = billingPeriodStart.getMonth();
  const bpYear = billingPeriodStart.getFullYear();

  const isFirstMonth = contractStartDate.getMonth() === bpMonth &&
    contractStartDate.getFullYear() === bpYear;

  if (isFirstMonth && contractStartDate.getDate() !== 1) {
    console.log(`Skipping monthly invoice for contract ${contract._id} - first month (target: ${billingPeriodStart.toLocaleDateString()}) already has prorated invoice`);
    return null;
  }


  // Create full monthly invoice
  const computedIssueDate = issueDate || new Date(currentYear, currentMonth, 25); // fallback to 25th if not provided
  const computedDueDate = dueDate || new Date(currentYear, currentMonth + 1, 7); // fallback to 7th of next month
  // Compute payment terms from issue/due date difference
  const msPerDay = 24 * 60 * 60 * 1000;
  let paymentTermsDays = Math.ceil((computedDueDate - computedIssueDate) / msPerDay);
  if (!Number.isFinite(paymentTermsDays) || paymentTermsDays <= 0) paymentTermsDays = 7;

  const items = [];
  let subtotal = 0;

  if (contract.monthlyRent > 0) {
    const monthName = billingPeriodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    const rentAmount = contract.monthlyRent;
    const contractLabel = String(contract.contractNumber || contract._id).slice(-6);
    const cabinLabel = await getCabinLabel(contract._id, contractLabel);
    items.push({
      description: cabinLabel,
      quantity: 1,
      unitPrice: rentAmount,
      amount: rentAmount,
      name: cabinLabel,
      rate: rentAmount,
      unit: "nos",
      item_total: rentAmount,
      item_id: contract.building?.zoho_monthly_payment_item_id || undefined
    });
    subtotal += rentAmount;
  }

  // Handle Add-ons
  if (Array.isArray(contract.addOns) && contract.addOns.length > 0) {
    const monthName = billingPeriodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    for (const addon of contract.addOns) {
      if (isAddonBillable(addon, periodStart, periodEnd)) {
        const qty = addon.quantity || 1; // Fallback for legacy data
        const totalAmount = addon.amount * qty;
        if (totalAmount > 0) {
          items.push({
            description: addon.description,
            quantity: qty,
            unitPrice: addon.amount,
            amount: totalAmount,
            name: addon.description,
            rate: addon.amount,
            unit: 'nos',
            item_total: totalAmount,
            item_id: addon.addonId?.zoho_item_id || undefined
          });
          subtotal += totalAmount;
        }
      }
    }
  }


  // Calculate taxes (18% GST)
  const taxRate = 18;
  const taxableAmount = subtotal;
  const taxes = taxRate > 0 ? [{ name: "GST", rate: taxRate, amount: round2(taxableAmount * (taxRate / 100)) }] : [];
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  const total = round2(subtotal + taxTotal);

  // Create invoice
  const invoiceNumber = await generateLocalInvoiceNumber();
  const invoiceData = {
    invoice_number: invoiceNumber,
    client: contract.client._id,
    contract: contract._id,
    building: contract.building._id,
    date: computedIssueDate,
    due_date: computedDueDate,
    billing_period: {
      start: billingPeriodStart,
      end: billingPeriodEnd
    },

    line_items: items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      name: item.name || item.description,
      rate: item.unitPrice,
      unit: item.unit || "nos",
      item_total: item.amount,
      tax_percentage: 18,
      item_id: item.item_id
    })),

    sub_total: round2(subtotal),
    tax_total: taxTotal,
    total,
    amount_paid: 0,
    balance: total,
    status: "draft",
    notes: `Monthly invoice for ${billingPeriodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}${formatBankDetails(contract.building, false)}`,

    // Zoho Books specific fields
    currency_code: "INR",
    exchange_rate: 1,
    gst_treatment: "business_gst",
    place_of_supply: contract.building?.place_of_supply || contract.client?.place_of_supply || contract.client?.billingAddress?.state_code,
    payment_terms: paymentTermsDays,
    payment_terms_label: `Net ${paymentTermsDays}`,

    // Client address mapping
    ...(contract.client.billingAddress && {
      billing_address: {
        attention: contract.client.contactPerson,
        address: contract.client.billingAddress.address,
        city: contract.client.billingAddress.city,
        state: contract.client.billingAddress.state,
        zip: contract.client.billingAddress.zip,
        country: contract.client.billingAddress.country || "IN",
        phone: contract.client.phone
      }
    }),

    // Client shipping address mapping
    ...(contract.client.shippingAddress && {
      shipping_address: {
        attention: contract.client.contactPerson,
        address: contract.client.shippingAddress.address,
        street2: contract.client.shippingAddress.street2,
        city: contract.client.shippingAddress.city,
        state: contract.client.shippingAddress.state,
        zip: contract.client.shippingAddress.zip,
        country: contract.client.shippingAddress.country || 'IN',
        phone: contract.client.phone
      }
    }),

    customer_id: contract.client.zohoBooksContactId,
    gst_no: contract.client.gstNo
  };

  const invoice = await Invoice.create(invoiceData);

  // Mark one-time add-ons as billed
  if (Array.isArray(contract.addOns) && contract.addOns.length > 0) {
    let modified = false;
    for (const addon of contract.addOns) {
      if (addon.status === 'active' && addon.billingCycle === 'one-time') {
        addon.status = 'billed';
        modified = true;
      }
    }
    if (modified) await contract.save();
  }

  console.log(`Created monthly invoice ${invoice._id} for contract ${contract._id}`);


  // Push to Zoho Books if client is synced
  try {
    if (contract.client.zohoBooksContactId) {
      const { createZohoInvoiceFromLocal } = await import("../utils/zohoBooks.js");
      const invObj = invoice.toObject();
      if (contract.building?.zoho_books_location_id) {
        invObj.zoho_books_location_id = contract.building.zoho_books_location_id;
      }
      if (contract.building?.zoho_tax_id) {
        invObj.zoho_tax_id = contract.building.zoho_tax_id;
      }
      const zohoResponse = await createZohoInvoiceFromLocal(invObj, contract.client.toObject());
      const invoiceData = zohoResponse.invoice || zohoResponse;

      if (invoiceData && invoiceData.invoice_id) {
        invoice.zoho_invoice_id = invoiceData.invoice_id;
        invoice.zoho_invoice_number = invoiceData.invoice_number;
        invoice.zoho_status = invoiceData.status || invoiceData.status_formatted;
        invoice.zoho_pdf_url = invoiceData.pdf_url;
        invoice.invoice_url = invoiceData.invoice_url;
        await invoice.save();

        console.log(`Pushed monthly invoice ${invoice._id} to Zoho Books: ${invoiceData.invoice_id}`);
      }
    }
  } catch (zohoError) {
    console.error(`Failed to push monthly invoice ${invoice._id} to Zoho Books:`, zohoError.message);
    // Don't fail the invoice creation if Zoho push fails
  }

  return invoice;
}

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

/**
 * Check if an add-on is billable within a given period
 */
function isAddonBillable(addon, periodStart, periodEnd) {
  if (addon.status === 'billed') return false;
  if (addon.status !== 'active') return false;

  if (addon.billingCycle === 'one-time') {
    return true;
  }

  const addonStart = addon.startDate ? new Date(addon.startDate) : null;
  const addonEnd = addon.endDate ? new Date(addon.endDate) : null;

  // Add-on must have started before or during this period
  if (addonStart && addonStart > periodEnd) return false;

  // Add-on must not have ended before this period
  if (addonEnd && addonEnd < periodStart) return false;

  return true;
}

/**
 * Fetch and format cabin numbers for a contract
 */
async function getCabinLabel(contractId, contractLabel) {
  try {
    const cabins = await Cabin.find({ contract: contractId }).select('number').lean();
    if (cabins && cabins.length > 0) {
      const numbers = cabins.map(c => c.number).join(', ');
      return `Cabin ${numbers}`;
    }
  } catch (err) {
    console.warn(`Failed to fetch cabins for contract ${contractId}:`, err.message);
  }
  return contractLabel ? `Contract ${contractLabel}` : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export const createMonthlyInvoicesConsolidated = async (refDate = new Date()) => {
  const results = { created: 0, errors: 0, details: [] };
  try {
    const now = refDate;

    const activeContracts = await Contract.find({
      status: 'active',
      $and: [
        {
          $or: [
            { billingStartDate: { $lte: new Date() } },
            { billingStartDate: { $exists: false }, startDate: { $lte: new Date() } }
          ]
        },
        {
          $or: [
            { endDate: { $gte: new Date() } },
            { endDate: null }
          ]
        }
      ]
    })
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone gstNo zohoBooksContactId billingAddress shippingAddress place_of_supply'
      })
      .populate({
        path: 'building',
        select: 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay lateFeePolicy bankDetails place_of_supply zoho_books_location_id city zoho_monthly_payment_item_id',
        populate: { path: 'city', select: 'name' }
      });

    // Group contracts by building+client
    const groups = new Map();
    for (const contract of activeContracts) {
      const building = contract.building;
      const client = contract.client;
      if (!building || !client) continue;
      const key = `${String(building._id)}:${String(client._id)}`;
      if (!groups.has(key)) groups.set(key, { building, client, contracts: [] });
      groups.get(key).contracts.push(contract);
    }

    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    // Shift to next month for billing
    const billingPeriodStart = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
    const billingPeriodEnd = new Date(Date.UTC(currentYear, currentMonth + 2, 0));

    for (const [key, group] of groups) {
      const { building, client, contracts } = group;
      try {
        const { shouldGenerateToday, issueDate, dueDate } = getInvoiceScheduleForBuilding(building, now);
        if (!shouldGenerateToday) {
          results.details.push({ group: key, status: 'skipped', reason: 'Not scheduled today for this building' });
          continue;
        }
        let existing = await Invoice.findOne({
          client: client._id,
          building: building._id,
          'billing_period.start': billingPeriodStart,
          'billing_period.end': billingPeriodEnd,
          type: 'regular',
          category: 'monthly'
        }).select('_id status');
        if (existing) {
          results.details.push({ group: key, status: 'exists', invoiceId: existing._id });
          continue;
        }

        // Safety: if a legacy per-contract monthly invoice exists in the same period, skip creating consolidated to avoid double billing
        const legacyExisting = await Invoice.findOne({
          client: client._id,
          building: building._id,
          'billing_period.start': billingPeriodStart,
          'billing_period.end': billingPeriodEnd,
          type: 'regular',
          category: 'monthly',
          contract: { $ne: null },
          status: { $ne: 'void' }
        }).select('_id status');
        if (legacyExisting) {
          results.details.push({ group: key, status: 'skipped', reason: 'Legacy per-contract monthly invoice exists for this period', invoiceId: legacyExisting._id });
          continue;
        }

        // Build consolidated line items (rent + late fees) across all contracts
        const items = [];
        let subtotal = 0;
        const cabinLabels = [];
        const monthName = billingPeriodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

        for (const c of contracts) {
          // First month rule: if started mid-month of target month, skip rent line (prorated handled elsewhere)
          const start = new Date(c.startDate);
          const bpMonth = billingPeriodStart.getMonth();
          const bpYear = billingPeriodStart.getFullYear();
          const isFirstMonth = start.getMonth() === bpMonth && start.getFullYear() === bpYear;
          if (isFirstMonth && start.getDate() !== 1) {
            continue;
          }
          const rentAmount = Number(c.monthlyRent || 0);
          const contractLabel = String(c.contractNumber || c._id).slice(-6);
          const cabinLabel = await getCabinLabel(c._id, contractLabel);
          if (cabinLabel) cabinLabels.push(cabinLabel);
          if (rentAmount > 0) {
            items.push({
              description: cabinLabel,
              quantity: 1,
              unitPrice: rentAmount,
              amount: rentAmount,
              name: cabinLabel,
              rate: rentAmount,
              unit: 'nos',
              item_total: rentAmount,
              item_id: (contract?.building?.zoho_monthly_payment_item_id || c?.building?.zoho_monthly_payment_item_id || b?.zoho_monthly_payment_item_id)
            });
            subtotal += rentAmount;
          }
          // Handle Add-ons
          if (Array.isArray(c.addOns) && c.addOns.length > 0) {
            const monthName = billingPeriodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
            for (const addon of c.addOns) {
              if (isAddonBillable(addon, billingPeriodStart, billingPeriodEnd)) {
                const qty = addon.quantity || 1; // Fallback for legacy data
                const totalAmount = addon.amount * qty;
                if (totalAmount > 0) {
                  items.push({
                    description: addon.description,
                    quantity: qty,
                    unitPrice: addon.amount,
                    amount: totalAmount,
                    name: addon.description,
                    rate: addon.amount,
                    unit: 'nos',
                    item_total: totalAmount,
                    item_id: addon.zoho_item_id || addon.addonId?.zoho_item_id || undefined
                  });
                  subtotal += totalAmount;
                  console.log(`[Consolidated Billing] Added add-on "${addon.description}" (₹${totalAmount}) for Contract ${contractLabel}`);
                }
              }
            }
          }
        }


        const taxRate = 18;
        const taxTotal = round2(subtotal * (taxRate / 100));
        const total = round2(subtotal + taxTotal);

        // Compute payment terms from issue/due date difference
        const msPerDay = 24 * 60 * 60 * 1000;
        let paymentTermsDays = Math.ceil((dueDate - issueDate) / msPerDay);
        if (!Number.isFinite(paymentTermsDays) || paymentTermsDays <= 0) paymentTermsDays = 7;

        const invoiceNumber = await generateLocalInvoiceNumber();
        const invoiceData = {
          invoice_number: invoiceNumber,
          client: client._id,
          contract: contracts.length === 1 ? contracts[0]._id : null,
          building: building._id,
          date: issueDate,
          due_date: dueDate,
          billing_period: { start: billingPeriodStart, end: billingPeriodEnd },
          type: 'regular',
          category: 'monthly',
          line_items: items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            name: item.name || item.description,
            rate: item.unitPrice,
            unit: item.unit || 'nos',
            item_total: item.amount,
            tax_percentage: 18,
            item_id: item.item_id
          })),
          sub_total: round2(subtotal),
          tax_total: taxTotal,
          total,
          amount_paid: 0,
          balance: total,
          status: 'draft',
          notes: `Monthly consolidated invoice for ${billingPeriodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}${formatBankDetails(building, false)}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: building?.place_of_supply || client?.place_of_supply || client?.billingAddress?.state_code || 'MH',
          payment_terms: paymentTermsDays,
          payment_terms_label: `Net ${paymentTermsDays}`,
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
          gst_no: client.gstNo,

          // Client shipping address mapping
          ...(client.shippingAddress && {
            shipping_address: {
              attention: client.contactPerson,
              address: client.shippingAddress.address,
              street2: client.shippingAddress.street2,
              city: client.shippingAddress.city,
              state: client.shippingAddress.state,
              zip: client.shippingAddress.zip,
              country: client.shippingAddress.country || 'IN',
              phone: client.phone
            }
          })
        };

        const invoice = await Invoice.create(invoiceData);

        // Mark one-time add-ons as billed across all contracts in the group
        for (const c of contracts) {
          if (Array.isArray(c.addOns) && c.addOns.length > 0) {
            let modified = false;
            for (const addon of c.addOns) {
              if (addon.status === 'active' && addon.billingCycle === 'one-time') {
                addon.status = 'billed';
                modified = true;
              }
            }
            if (modified) await c.save();
          }
        }

        try {
          if (client.zohoBooksContactId) {
            const { createZohoInvoiceFromLocal } = await import("../utils/zohoBooks.js");
            const invObj = invoice.toObject();
            if (building?.zoho_books_location_id) {
              invObj.zoho_books_location_id = building.zoho_books_location_id;
            }
            const zohoResponse = await createZohoInvoiceFromLocal(invObj, client.toObject());
            const inv = zohoResponse.invoice || zohoResponse;
            if (inv && inv.invoice_id) {
              invoice.zoho_invoice_id = inv.invoice_id;
              invoice.zoho_invoice_number = inv.invoice_number;
              invoice.zoho_status = inv.status || inv.status_formatted;
              invoice.zoho_pdf_url = inv.pdf_url;
              await invoice.save();
            }
          }
        } catch (zohoErr) {
          console.warn(`[Pipeline-Consolidated] Failed to push invoice ${invoice._id} to Zoho:`, zohoErr.message);
        }

        results.created++;
        results.details.push({
          group: key,
          status: 'success',
          invoiceId: invoice._id,
          clientName: client.companyName || client.contactPerson || 'Client',
          buildingName: building.name,
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total
        });
      } catch (err) {
        console.error(`Error creating consolidated invoice for ${key}:`, err);
        results.errors++;
        results.details.push({ group: key, status: 'error', error: err.message });
      }
    }

    if (results.created > 0) {
      await notifyAdminsOfInvoiceBatch(results, 'generated (consolidated)');
    }
  } catch (error) {
    console.error('Error in consolidated monthly invoice generation:', error);
    throw error;
  }
};

export const createMonthlyEstimates = async (refDate = new Date()) => {
  const results = { created: 0, skipped: 0, errors: 0, details: [] };
  try {
    const now = refDate;
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    // Shift to next month
    const periodStart = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
    const periodEnd = new Date(Date.UTC(currentYear, currentMonth + 2, 0));

    const activeContracts = await Contract.find({
      status: 'active',
      $and: [
        {
          $or: [
            { billingStartDate: { $lte: periodEnd } },
            { billingStartDate: { $exists: false }, startDate: { $lte: periodEnd } }
          ]
        },
        {
          $or: [
            { endDate: { $gte: periodStart } },
            { endDate: null }
          ]
        }
      ]
    })
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone gstNo zohoBooksContactId billingAddress shippingAddress place_of_supply'
      })
      .populate({
        path: 'building',
        select: 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay lateFeePolicy bankDetails place_of_supply zoho_books_location_id city zoho_monthly_payment_item_id',
        populate: { path: 'city', select: 'name' }
      })
      .populate('addOns.addonId');

    for (const contract of activeContracts) {
      try {
        const building = contract.building;
        if (!building) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'No building' });
          continue;
        }

        // Defer until first billable month (billingStartDate || startDate)
        const firstBillDate = contract.billingStartDate ? new Date(contract.billingStartDate) : new Date(contract.startDate);

        // Compare against target billing period (periodStart)
        // If target period < first billable month, skip
        if (periodStart < new Date(Date.UTC(firstBillDate.getUTCFullYear(), firstBillDate.getUTCMonth(), 1))) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'Before first billable month' });
          continue;
        }

        // First Month Mid-Start Check
        const isFirstMonth = firstBillDate.getMonth() === periodStart.getMonth() &&
          firstBillDate.getFullYear() === periodStart.getFullYear();

        if (isFirstMonth && firstBillDate.getDate() !== 1) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'First month mid-start (manual proration)' });
          continue;
        }

        // Per-building schedule
        const { shouldGenerateToday, issueDate, dueDate } = getInvoiceScheduleForBuilding(building, now);
        if (!shouldGenerateToday) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'Not scheduled today for this building' });
          continue;
        }

        // Idempotency: if any estimate exists for this contract overlapping current month, skip
        const existingEstimate = await Estimate.findOne({
          contract: contract._id,
          'billing_period.start': { $gte: periodStart, $lte: periodEnd }
        }).select('_id');
        if (existingEstimate) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'exists', estimateId: existingEstimate._id });
          continue;
        }

        // Create estimate line for monthly rent only
        const items = [];
        let subtotal = 0;
        if (Number(contract.monthlyRent || 0) > 0) {
          const monthName = periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
          const rentAmount = Number(contract.monthlyRent);
          const contractLabel = String(contract.contractNumber || contract._id).slice(-6);
          const cabinLabel = await getCabinLabel(contract._id, contractLabel);
          items.push({
            description: cabinLabel,
            quantity: 1,
            unitPrice: rentAmount,
            amount: rentAmount,
            name: cabinLabel,
            rate: rentAmount,
            unit: 'nos',
            item_total: rentAmount,
            item_id: contract.building?.zoho_monthly_payment_item_id || undefined
          });
          subtotal += rentAmount;
        }

        // Handle Add-ons
        if (Array.isArray(contract.addOns) && contract.addOns.length > 0) {
          const monthName = periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
          for (const addon of contract.addOns) {
            if (isAddonBillable(addon, periodStart, periodEnd)) {
              const qty = addon.quantity || 1; // Fallback for legacy data
              const totalAmount = addon.amount * qty;
              if (totalAmount > 0) {
                const contractLabel = String(contract.contractNumber || contract._id).slice(-6);
                const cabinLabel = await getCabinLabel(contract._id, contractLabel);
                items.push({
                  description: addon.description,
                  quantity: qty,
                  unitPrice: addon.amount,
                  amount: totalAmount,
                  name: addon.description,
                  rate: addon.amount,
                  unit: 'nos',
                  item_total: totalAmount,
                  item_id: addon.zoho_item_id || addon.addonId?.zoho_item_id || undefined
                });
                subtotal += totalAmount;
              }
            }
          }
        }


        const taxRate = 18;
        const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
        const total = Math.round((subtotal + taxTotal) * 100) / 100;

        const estimateDoc = await Estimate.create({
          client: contract.client._id,
          contract: contract._id,
          building: building._id,
          zoho_tax_id: building.zoho_tax_id || undefined,
          date: issueDate,
          expiry_date: dueDate,
          billing_period: { start: periodStart, end: periodEnd },
          line_items: items.map(it => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
            name: it.name || it.description,
            rate: it.unitPrice,
            unit: it.unit || 'nos',
            item_total: it.amount,
            tax_percentage: 18,
            item_id: it.item_id
          })),
          sub_total: Math.round(subtotal * 100) / 100,
          tax_total: taxTotal,
          total,
          status: 'draft',
          notes: `Monthly Pro Forma for ${periodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}${formatBankDetails(contract.building, true)}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: contract.building?.place_of_supply || contract.client?.billingAddress?.state_code,
          ...(contract.client.billingAddress && {
            billing_address: {
              attention: contract.client.contactPerson,
              address: contract.client.billingAddress.address,
              city: contract.client.billingAddress.city,
              state: contract.client.billingAddress.state,
              zip: contract.client.billingAddress.zip,
              country: contract.client.billingAddress.country || 'IN',
              phone: contract.client.phone
            }
          }),

          // Client shipping address mapping
          ...(contract.client.shippingAddress && {
            shipping_address: {
              attention: contract.client.contactPerson,
              address: contract.client.shippingAddress.address,
              street2: contract.client.shippingAddress.street2,
              city: contract.client.shippingAddress.city,
              state: contract.client.shippingAddress.state,
              zip: contract.client.shippingAddress.zip,
              country: contract.client.shippingAddress.country || 'IN',
              phone: contract.client.phone
            }
          }),

          customer_id: contract.client.zohoBooksContactId,
          gst_no: contract.client.gstNo
        });

        // Mark one-time add-ons as billed
        if (Array.isArray(contract.addOns) && contract.addOns.length > 0) {
          let modified = false;
          for (const addon of contract.addOns) {
            if (addon.status === 'active' && addon.billingCycle === 'one-time') {
              addon.status = 'billed';
              modified = true;
            }
          }
          if (modified) await contract.save();
        }


        try {
          if (contract.client.zohoBooksContactId) {
            const { createZohoEstimateFromLocal, fetchZohoEstimatePdfBinary } = await import('../utils/zohoBooks.js');
            const estObj = estimateDoc.toObject();
            if (building?.zoho_books_location_id) {
              estObj.zoho_books_location_id = building.zoho_books_location_id;
            }
            const zohoResp = await createZohoEstimateFromLocal(estObj, contract.client.toObject());

            if (zohoResp?.estimate?.estimate_id) {
              const zId = zohoResp.estimate.estimate_id;
              // Update local estimate with Zoho ID
              estimateDoc.zoho_estimate_id = zId;
              estimateDoc.estimate_number = zohoResp.estimate.estimate_number;
              await estimateDoc.save();

              // --- Notification Logic ---
              let pdfBuffer = null;
              try {
                pdfBuffer = await fetchZohoEstimatePdfBinary(zId);
              } catch (pdfErr) {
                console.warn(`[MonthlyEstimateSingle] Failed to fetch PDF for estimate ${zId}:`, pdfErr.message);
              }

              const financeRoles = await Role.find({
                roleName: { $in: ['Finance Senior', 'Finance Junior'] }
              }).select('_id roleName');

              if (financeRoles.length > 0) {
                const roleIds = financeRoles.map(r => r._id);
                const financeUsers = await User.find({ role: { $in: roleIds } }).select('email name phone');

                if (financeUsers.length > 0) {
                  const attachments = pdfBuffer ? [{
                    filename: `${estimateDoc.estimate_number || 'Estimate'}.pdf`,
                    content: pdfBuffer
                  }] : [];

                  const generatedDate = new Date().toLocaleDateString('en-IN');
                  const billingPeriodDates = `${contract.billingStartDate ? new Date(contract.billingStartDate).toLocaleDateString('en-IN') : 'N/A'}`; // Simplified for single contract

                  await Promise.allSettled(financeUsers.map(u =>
                    sendNotification({
                      to: { email: u.email, userId: u._id },
                      channels: { email: true, sms: false },
                      templateKey: 'proforma_invoice_approval_required',
                      templateVariables: {
                        companyName: contract.client.companyName || contract.client.contactPerson || 'Client',
                        clientName: contract.client.contactPerson || 'Valued Client',
                        buildingName: contract.building.name,
                        billingPeriod: billingPeriodDates,
                        proformaNumber: estimateDoc.estimate_number || 'PENDING',
                        totalAmount: estimateDoc.total,
                        dueDate: estimateDoc.expiry_date ? new Date(estimateDoc.expiry_date).toLocaleDateString('en-IN') : 'N/A',
                        generatedDate: generatedDate,
                        proformaId: estimateDoc._id
                      },
                      title: 'Approval Required – Pro Forma Invoice',
                      attachments,
                      metadata: {
                        deepLink: `ofis://invoices/proforma/${estimateDoc._id}`,
                        route: `/invoices/proforma/${estimateDoc._id}`,
                        routeParams: { id: String(estimateDoc._id) },
                        priority: "high",
                        category: "billing",
                        tags: ["invoice", "approval", "proforma"]
                      },
                      source: 'system',
                      type: 'transactional'
                    })
                  ));
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to push monthly estimate to Zoho (non-blocking):', e?.message || e);
        }

        results.created++; results.details.push({ contractId: contract._id, status: 'created', estimateId: estimateDoc._id });
      } catch (err) {
        results.errors++; results.details.push({ contractId: contract._id, status: 'error', error: err?.message || String(err) });
      }
    }

    console.log(`Monthly estimate generation completed: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`);
    return results;
  } catch (error) {
    console.error('Error in monthly estimate generation:', error);
    throw error;
  }
};

export const createMonthlyEstimatesConsolidated = async (refDate = new Date()) => {
  const results = { created: 0, skipped: 0, errors: 0, details: [] };
  try {
    const now = refDate;
    // Generate ONLY for next month's period
    const baseYear = now.getFullYear();
    const baseMonth = now.getMonth();

    // Shift logic: if now is Jan, baseMonth=0. Target Feb (Month=1)
    // Shift logic: if now is Jan, baseMonth=0. Target Feb (Month=1)
    // Use UTC midnights to ensure consistency across environments
    const periodStart = new Date(Date.UTC(baseYear, baseMonth + 1, 1));
    const periodEnd = new Date(Date.UTC(baseYear, baseMonth + 2, 0));

    // Fetch active contracts with client and building schedule fields
    const activeContracts = await Contract.find({
      status: 'active',
      $and: [
        {
          $or: [
            { billingStartDate: { $lte: periodEnd } },
            { billingStartDate: { $exists: false }, startDate: { $lte: periodEnd } }
          ]
        },
        {
          $or: [
            { endDate: { $gte: periodStart } },
            { endDate: null }
          ]
        }
      ]
    })
      .populate({
        path: 'client',
        select: 'companyName contactPerson email phone gstNo zohoBooksContactId billingAddress shippingAddress place_of_supply'
      })
      .populate({
        path: 'building',
        select: 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay place_of_supply zoho_books_location_id bankDetails city zoho_monthly_payment_item_id',
        populate: { path: 'city', select: 'name' }
      })
      .populate('addOns.addonId');

    // Group by building+client
    const groups = new Map();
    for (const contract of activeContracts) {
      const building = contract.building;
      const client = contract.client;
      if (!building || !client) {
        results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'No building/client' });
        continue;
      }
      const key = `${String(building._id)}:${String(client._id)}`;
      if (!groups.has(key)) groups.set(key, { building, client, contracts: [] });
      groups.get(key).contracts.push(contract);
    }

    // Process each group
    for (const [key, group] of groups) {
      const { building, client, contracts } = group;
      try {
        // Respect building schedule
        const { shouldGenerateToday, issueDate, dueDate } = getInvoiceScheduleForBuilding(building, now);
        if (!shouldGenerateToday) {
          results.skipped++; results.details.push({ group: key, status: 'skipped', reason: 'Not scheduled today for this building' });
          continue;
        }

        // Idempotency: one consolidated estimate per client+building+period
        const existing = await Estimate.findOne({
          client: client._id,
          building: building._id,
          'billing_period.start': periodStart,
          'billing_period.end': periodEnd
        }).select('_id');
        if (existing) {
          results.skipped++; results.details.push({ group: key, status: 'exists', estimateId: existing._id });
          continue;
        }

        // Build line items: one per eligible contract
        const items = [];
        let subtotal = 0;
        const cabinLabels = [];
        const monthName = periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

        for (const c of contracts) {
          const firstBillDate = c.billingStartDate ? new Date(c.billingStartDate) : new Date(c.startDate);

          // Compare against target billing period (periodStart)
          // If target period < first billable month, skip
          if (periodStart < new Date(firstBillDate.getFullYear(), firstBillDate.getMonth(), 1)) continue;

          const isFirstBillMonth = firstBillDate.getFullYear() === periodStart.getFullYear() &&
            firstBillDate.getMonth() === periodStart.getMonth();

          if (isFirstBillMonth && firstBillDate.getDate() !== 1) continue;

          const rentAmount = Number(c.monthlyRent || 0);
          const contractLabel = String(c.contractNumber || c._id).slice(-6);
          const cabinLabel = await getCabinLabel(c._id, contractLabel);
          if (cabinLabel) cabinLabels.push(cabinLabel);
          if (rentAmount > 0) {
            items.push({
              description: cabinLabel,
              quantity: 1,
              unitPrice: rentAmount,
              amount: rentAmount,
              name: cabinLabel,
              rate: rentAmount,
              unit: 'nos',
              item_total: rentAmount,
              item_id: c.building?.zoho_monthly_payment_item_id || undefined
            });
            subtotal += rentAmount;
          }

          // Handle Add-ons
          if (Array.isArray(c.addOns) && c.addOns.length > 0) {
            for (const addon of c.addOns) {
              if (isAddonBillable(addon, periodStart, periodEnd)) {
                const qty = addon.quantity || 1; // Fallback for legacy data
                const totalAmount = addon.amount * qty;
                if (totalAmount > 0) {
                  items.push({
                    description: addon.description,
                    quantity: qty,
                    unitPrice: addon.amount,
                    amount: totalAmount,
                    name: addon.description,
                    rate: addon.amount,
                    unit: 'nos',
                    item_total: totalAmount,
                    item_id: addon.zoho_item_id || addon.addonId?.zoho_item_id || undefined
                  });
                  subtotal += totalAmount;
                  console.log(`[Consolidated Estimate] Added add-on "${addon.description}" (₹${totalAmount}) for Contract ${contractLabel}`);
                }
              }
            }
          }
        }


        // If no items, skip creating empty estimate
        if (items.length === 0) {
          results.skipped++; results.details.push({ group: key, status: 'skipped', reason: 'No billable items' });
          continue;
        }

        // Taxes (18%)
        const taxRate = 18;
        const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
        const total = Math.round((subtotal + taxTotal) * 100) / 100;

        const estimateDoc = await Estimate.create({
          client: client._id,
          contract: contracts.length === 1 ? contracts[0]._id : null,
          building: building._id,
          zoho_tax_id: building.zoho_tax_id || undefined,
          date: issueDate,
          expiry_date: dueDate,
          billing_period: { start: periodStart, end: periodEnd },
          line_items: items.map(it => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.amount,
            name: it.name || it.description,
            rate: it.unitPrice,
            unit: it.unit || 'nos',
            item_total: it.amount,
            tax_percentage: 18,
            item_id: it.item_id
          })),
          sub_total: Math.round(subtotal * 100) / 100,
          tax_total: taxTotal,
          total,
          status: 'draft',
          notes: `Monthly Pro Forma (Consolidated) for ${periodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}${formatBankDetails(building, true)}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: building?.place_of_supply || client?.building?.place_of_supply || client?.billingAddress?.state_code,
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
          gst_no: client.gstNo,
          // Client shipping address mapping
          ...(client.shippingAddress && {
            shipping_address: {
              attention: client.contactPerson,
              address: client.shippingAddress.address,
              street2: client.shippingAddress.street2,
              city: client.shippingAddress.city,
              state: client.shippingAddress.state,
              zip: client.shippingAddress.zip,
              country: client.shippingAddress.country || 'IN',
              phone: client.phone
            }
          }),
        });

        // Mark one-time add-ons as billed across all contracts in the group
        for (const c of contracts) {
          if (Array.isArray(c.addOns) && c.addOns.length > 0) {
            let modified = false;
            for (const addon of c.addOns) {
              if (addon.status === 'active' && addon.billingCycle === 'one-time') {
                addon.status = 'billed';
                modified = true;
              }
            }
            if (modified) await c.save();
          }
        }


        // Push to Zoho (non-blocking)

        try {
          if (client.zohoBooksContactId) {
            const { createZohoEstimateFromLocal, fetchZohoEstimatePdfBinary } = await import('../utils/zohoBooks.js');
            const estObj = estimateDoc.toObject();
            if (building?.zoho_books_location_id) {
              estObj.zoho_books_location_id = building.zoho_books_location_id;
            }
            const zohoResp = await createZohoEstimateFromLocal(estObj, client.toObject());

            if (zohoResp?.estimate?.estimate_id) {
              const zId = zohoResp.estimate.estimate_id;
              // Update local estimate with Zoho ID
              estimateDoc.zoho_estimate_id = zId;
              estimateDoc.estimate_number = zohoResp.estimate.estimate_number; // Sync number if generated by Zoho
              await estimateDoc.save();

              // --- Notification Logic ---
              // 1. Fetch PDF
              let pdfBuffer = null;
              try {
                pdfBuffer = await fetchZohoEstimatePdfBinary(zId);
              } catch (pdfErr) {
                console.warn(`[MonthlyEstimate] Failed to fetch PDF for estimate ${zId}:`, pdfErr.message);
              }

              // 2. Find Finance Users (Senior & Junior)
              // We look for roles with names "Finance Senior" or "Finance Junior"
              const financeRoles = await Role.find({
                roleName: { $in: ['Finance Senior', 'Finance Junior'] }
              }).select('_id roleName');

              if (financeRoles.length > 0) {
                const roleIds = financeRoles.map(r => r._id);
                const financeUsers = await User.find({ role: { $in: roleIds } }).select('email name phone');

                if (financeUsers.length > 0) {
                  // 3. Send Notification to each finance user
                  const attachments = pdfBuffer ? [{
                    filename: `${estimateDoc.estimate_number || 'Estimate'}.pdf`,
                    content: pdfBuffer
                  }] : [];

                  const generatedDate = new Date().toLocaleDateString('en-IN');
                  const billingPeriodDates = `${periodStart.toLocaleDateString('en-IN')} - ${periodEnd.toLocaleDateString('en-IN')}`;

                  console.log(`[MonthlyEstimate] Sending approval notification to ${financeUsers.length} finance users.`);

                  await Promise.allSettled(financeUsers.map(u =>
                    sendNotification({
                      to: { email: u.email, userId: u._id },
                      channels: { email: true, sms: false },
                      templateKey: 'proforma_invoice_approval_required',
                      templateVariables: {
                        companyName: client.companyName || client.contactPerson || 'Client',
                        clientName: client.contactPerson || 'Valued Client',
                        buildingName: building.name,
                        billingPeriod: billingPeriodDates,
                        proformaNumber: estimateDoc.estimate_number || 'PENDING',
                        totalAmount: estimateDoc.total,
                        dueDate: estimateDoc.expiry_date ? new Date(estimateDoc.expiry_date).toLocaleDateString('en-IN') : 'N/A',
                        generatedDate: generatedDate,
                        proformaId: estimateDoc._id
                      },
                      title: 'Approval Required – Pro Forma Invoice',
                      attachments, // Pass PDF
                      metadata: {
                        deepLink: `ofis://invoices/proforma/${estimateDoc._id}`,
                        route: `/invoices/proforma/${estimateDoc._id}`,
                        routeParams: { id: String(estimateDoc._id) },
                        priority: "high",
                        category: "billing",
                        tags: ["invoice", "approval", "proforma"]
                      },
                      source: 'system',
                      type: 'transactional'
                    })
                  ));
                } else {
                  console.log('[MonthlyEstimate] No users found with Finance roles.');
                }
              } else {
                console.log('[MonthlyEstimate] Finance roles not found in DB.');
              }
            }
          }
        } catch (e) {
          console.warn('Failed to push consolidated monthly estimate to Zoho or send notification (non-blocking):', e?.message || e);
        }

        results.created++; results.details.push({ group: key, status: 'created', estimateId: estimateDoc._id });
      } catch (err) {
        console.error(`[Consolidated Estimate] Failed to create estimate for group ${key}:`, err);
        results.errors++; results.details.push({ group: key, status: 'error', error: err?.message || String(err) });
      }
    }

    console.log(`Consolidated monthly estimate generation completed: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`);
    return results;
  } catch (error) {
    console.error('Error in consolidated monthly estimate generation:', error);
    throw error;
  }
};

/**
 * Stage 3: Automated "Send" for Approved Estimates (default 26th)
 * Finds estimates with status 'approved_internal', emails them to clients, updates status to 'sent'
 */
export const processApprovedEstimatesForSending = async (refDate = new Date()) => {
  const results = { sent: 0, errors: 0, details: [] };
  const now = refDate;
  const currentDay = now.getDate();

  try {
    const buildings = await Building.find({ draftInvoiceGeneration: true });
    for (const building of buildings) {
      const sendDay = building.estimateSendDay || 26;
      if (currentDay !== sendDay) continue;

      const approvedEstimates = await Estimate.find({
        building: building._id,
        status: 'approved_internal'
      }).populate('client');

      for (const estimate of approvedEstimates) {
        try {
          // 1. Fetch PDF from Zoho if available
          let attachments = [];
          if (estimate.zoho_estimate_id) {
            try {
              const { fetchZohoEstimatePdfBinary } = await import('../utils/zohoBooks.js');
              const pdfBuffer = await fetchZohoEstimatePdfBinary(estimate.zoho_estimate_id);
              if (pdfBuffer) {
                attachments.push({
                  filename: `${estimate.estimate_number || 'ProForma'}.pdf`,
                  content: pdfBuffer
                });
              }
            } catch (pdfErr) {
              console.warn(`[Pipeline-Send] Failed to fetch PDF for estimate ${estimate._id}:`, pdfErr.message);
            }
          }

          // 2. Send to Client
          try {
            await sendNotification({
              to: { email: estimate.client.email, userId: estimate.client._id },
              channels: { email: true, sms: false },
              templateKey: 'proforma_invoice_sent',
              templateVariables: {
                greeting: "Ofis Square",
                companyName: estimate.client.companyName || estimate.client.contactPerson || 'Client',
                clientName: estimate.client.contactPerson || 'Valued Client',
                buildingName: building.name,
                totalAmount: estimate.total,
                dueDate: estimate.expiry_date ? new Date(estimate.expiry_date).toLocaleDateString('en-IN') : 'N/A',
                proformaNumber: estimate.estimate_number,
                proformaId: estimate._id
              },
              title: `Pro Forma Invoice - ${building.name}`,
              attachments,
              source: 'system'
            });
          } catch (notifErr) {
            console.error(`[Pipeline-Send] Failed to send notification for estimate ${estimate._id}:`, notifErr.message);
            // We proceed with status update even if notification fails
          }

          // 3. Update Status
          estimate.status = 'sent';
          await estimate.save();
          results.sent++;
          results.details.push({ estimateId: estimate._id, status: 'sent' });
        } catch (err) {
          results.errors++;
          results.details.push({ estimateId: estimate._id, status: 'error', error: err.message });
        }
      }
    }
    return results;
  } catch (error) {
    console.error('Error in processApprovedEstimatesForSending:', error);
    throw error;
  }
};

/**
 * Stage 4: Automated "Invoice" from Sent Estimates (default 1st)
 * Converts 'sent' estimates into official Invoices
 */
export const convertSentEstimatesToInvoices = async (refDate = new Date()) => {
  const results = { converted: 0, errors: 0, details: [] };
  const now = refDate;
  const currentDay = now.getDate();

  try {
    const buildings = await Building.find({ draftInvoiceGeneration: true });
    for (const building of buildings) {
      const invoiceDay = building.invoiceSendDay || 1;
      if (currentDay !== invoiceDay) continue;

      const sentEstimates = await Estimate.find({
        building: building._id,
        status: 'sent'
      }).populate('client');

      for (const estimate of sentEstimates) {
        try {
          // Check for existing invoice to avoid duplicates
          const existing = await Invoice.findOne({
            client: estimate.client._id,
            building: estimate.building,
            'billing_period.start': estimate.billing_period.start,
            'billing_period.end': estimate.billing_period.end,
            type: 'regular',
            category: 'monthly'
          });

          if (existing) {
            estimate.status = 'invoiced';
            await estimate.save();
            results.details.push({ estimateId: estimate._id, status: 'already_invoiced' });
            continue;
          }

          // Create Invoice
          const invoiceNumber = await generateLocalInvoiceNumber();
          const invoiceData = {
            ...estimate.toObject(),
            _id: undefined, // Let MongoDB generate new ID
            invoice_number: invoiceNumber,
            createdAt: undefined,
            updatedAt: undefined,
            status: 'issued', // Official invoice status
            type: 'regular',
            category: 'monthly',
            date: new Date(),
            due_date: estimate.expiry_date // Inherit expiry from estimate
          };

          const invoice = await Invoice.create(invoiceData);

          // Update Estimate
          estimate.status = 'invoiced';
          await estimate.save();

          // Push to Zoho (official Invoice)
          try {
            const { createZohoInvoiceFromLocal } = await import('../utils/zohoBooks.js');
            const invObj = invoice.toObject();
            // Building should be populated or available from building variable in loop
            const buildingDoc = await Building.findById(invoice.building);
            if (buildingDoc?.zoho_books_location_id) {
              invObj.zoho_books_location_id = buildingDoc.zoho_books_location_id;
            }
            await createZohoInvoiceFromLocal(invObj, estimate.client.toObject());
          } catch (zohoErr) {
            console.warn(`[Pipeline-Invoice] Failed to push invoice ${invoice._id} to Zoho:`, zohoErr.message);
          }

          results.converted++;
          results.details.push({
            estimateId: estimate._id,
            invoiceId: invoice._id,
            status: 'success',
            clientName: estimate.client.companyName || estimate.client.contactPerson || 'Client',
            buildingName: building.name,
            invoiceNumber: invoice.invoice_number,
            amount: invoice.total
          });
        } catch (err) {
          results.errors++;
          results.details.push({ estimateId: estimate._id, status: 'error', error: err.message });
        }
      }
    }

    if (results.converted > 0) {
      // For conversion, we treat them as 'converted' invoices
      const formattedResults = {
        ...results,
        created: results.converted // Map for helper
      };
      await notifyAdminsOfInvoiceBatch(formattedResults, 'converted');
    }
    return results;
  } catch (error) {
    console.error('Error in convertSentEstimatesToInvoices:', error);
    throw error;
  }
};

/**
 * Helper to notify System Admins of a processed batch of invoices or estimates
 */
async function notifyAdminsOfInvoiceBatch(batchResults, type = 'generated') {
  try {
    const adminRole = await Role.findOne({ roleName: 'System Admin' });
    if (!adminRole) {
      console.warn('[Pipeline-Notify] System Admin role not found for notification');
      return;
    }

    const admins = await User.find({ role: adminRole._id }).select('email name');
    if (admins.length === 0) {
      console.warn('[Pipeline-Notify] No System Admin users found for notification');
      return;
    }

    const successfulItems = (batchResults.details || []).filter(d =>
      ['success', 'created', 'converted'].includes(d.status)
    );

    if (successfulItems.length === 0) return;

    let table = `| Building | Client/Company | Invoice # | Amount |\n`;
    table += `| :--- | :--- | :--- | :--- |\n`;

    for (const item of successfulItems) {
      const buildingName = item.buildingName || 'N/A';
      const clientName = item.clientName || 'N/A';
      const invNum = item.invoiceNumber || 'PENDING';
      const amount = item.amount || 0;
      table += `| ${buildingName} | ${clientName} | ${invNum} | ₹${amount.toLocaleString('en-IN')} |\n`;
    }

    const now = new Date();
    const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

    await Promise.allSettled(admins.map(admin =>
      sendNotification({
        to: { email: admin.email, userId: admin._id },
        channels: { email: true, sms: false },
        templateKey: 'admin_invoice_batch_summary',
        templateVariables: {
          greeting: "Ofis Square",
          date: dateStr,
          type: type,
          count: successfulItems.length,
          errorCount: batchResults.errors || 0,
          summaryTable: table
        },
        title: `Monthly Invoice Batch Summary - ${type.includes('generated') ? 'Generated' : 'Converted'}`,
        source: 'system',
        type: 'transactional'
      })
    ));
    console.log(`[Pipeline-Notify] Admin notification sent for batch of ${successfulItems.length} invoices`);
  } catch (err) {
    console.error('[Pipeline-Notify] Failed to notify admins of invoice batch:', err);
  }
}
