import Invoice from "../models/invoiceModel.js";
import Estimate from "../models/estimateModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { sendNotification } from "../utils/notificationHelper.js";

/**
 * Create monthly invoices for all active contracts
 * Runs daily; decides per building whether today is the generation day
 */
export const createMonthlyInvoices = async () => {
  const results = { created: 0, errors: 0, details: [] };

  try {
    const now = new Date();

    // Get all active contracts
    const activeContracts = await Contract.find({
      status: 'active',
      startDate: { $lte: new Date() },
      $or: [
        { endDate: { $gte: new Date() } },
        { endDate: null }
      ]
    })
      .populate("client")
      // Include building-level invoice scheduling fields
      .populate("building", "name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay lateFeePolicy");

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

        await createMonthlyInvoiceForContract(contract, { issueDate, dueDate });
        results.created++;
        results.details.push({ contractId: contract._id, status: 'success' });
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

  const issueDate = new Date(currentYear, currentMonth, normalizedIssueDay);

  // Due date on the configured day of the NEXT month
  const nextMonth = currentMonth + 1;
  const lastDayOfNextMonth = new Date(currentYear, nextMonth + 1, 0).getDate();
  const normalizedDueDay = Math.min(Math.max(1, dueDayConfigured), lastDayOfNextMonth);
  const dueDate = new Date(currentYear, nextMonth, normalizedDueDay);

  return { shouldGenerateToday, issueDate, dueDate };
}

// -------- Late fee helpers --------
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toDateYMD(year, month0, day) { return new Date(year, month0, day); }
function clampDate(date, min, max) { return date < min ? min : (date > max ? max : date); }
function diffDaysInclusive(a, b) {
  const ms = toDateYMD(a.getFullYear(), a.getMonth(), a.getDate()) - toDateYMD(b.getFullYear(), b.getMonth(), b.getDate());
  const abs = Math.floor(Math.abs(ms) / (24 * 60 * 60 * 1000));
  return abs + 1;
}

function getLastMonthPeriod(refDate) {
  const current = startOfMonth(refDate);
  const lastMonthDate = addDays(current, -1); // last day of previous month
  const start = startOfMonth(lastMonthDate);
  const end = endOfMonth(lastMonthDate);
  return { start, end, year: start.getFullYear(), month: start.getMonth() + 1 };
}

function resolveEffectiveLateFeePolicy(clientDoc, buildingDoc) {
  const buildingPolicy = buildingDoc?.lateFeePolicy || {};
  const clientPolicy = clientDoc?.lateFeePolicy || {};

  // If client explicitly disables
  if (clientPolicy?.enabled === false) {
    return { enabled: false, reason: clientPolicy?.reason || 'Client override disabled' };
  }

  const enabled = clientPolicy?.enabled ?? buildingPolicy?.enabled ?? false;
  const gracePeriodDays = clientPolicy?.gracePeriodDays ?? buildingPolicy?.gracePeriodDays ?? 0;
  const customFormula = clientPolicy?.customFormula ?? buildingPolicy?.customFormula ?? undefined;
  const variables = { ...(buildingPolicy?.variables || {}), ...(clientPolicy?.variables || {}) };

  return { enabled, gracePeriodDays, customFormula, variables };
}

function evaluateLateFeeAmount({ formula, variables }) {
  // Allowed variables
  const allowedKeys = ['outstanding', 'overdueDays', 'rate', 'maxCap', 'dailyFlat'];
  const safeVars = {};
  for (const k of allowedKeys) safeVars[k] = Number(variables?.[k] || 0);

  // If formula provided, evaluate safely
  if (formula && typeof formula === 'string' && formula.trim()) {
    // Validate tokens: only numbers, operators, parens, dots, spaces, and allowed identifiers
    const identifierRegex = /[A-Za-z_][A-Za-z0-9_]*/g;
    const tokens = formula.match(identifierRegex) || [];
    for (const t of tokens) {
      if (!allowedKeys.includes(t)) {
        throw new Error(`Late fee formula contains unsupported identifier: ${t}`);
      }
    }
    const transformed = formula.replace(identifierRegex, (name) => `vars.${name}`);
    try {
      const fn = new Function('vars', `return (${transformed});`);
      const val = fn(safeVars);
      return Number.isFinite(val) ? Math.max(0, val) : 0;
    } catch (e) {
      throw new Error(`Failed to evaluate late fee formula: ${e.message}`);
    }
  }

  // Fallback: dailyFlat per day (default 500)
  const perDay = Number(variables?.dailyFlat || 500);
  const overdueDays = Number(variables?.overdueDays || 0);
  return Math.max(0, perDay * overdueDays);
}

async function upsertProvisionalLateFeesForLastMonth(contract, clientDoc, buildingDoc) {
  const policy = resolveEffectiveLateFeePolicy(clientDoc, buildingDoc);
  if (!policy.enabled) return { created: 0 };

  const refDate = new Date();
  const { start: periodStart, end: periodEnd, year, month } = getLastMonthPeriod(refDate);

  // Find candidate invoices for this client+contract with due_date before or within last month and outstanding > 0
  const invoices = await Invoice.find({
    client: contract.client._id,
    contract: contract._id,
    status: { $ne: 'void' },
    due_date: { $lte: periodEnd }
  }).select('invoice_number due_date paid_at total amount_paid balance status');

  let created = 0;
  let updated = 0;
  let checked = 0;

  for (const inv of invoices) {
    checked++;
    const due = inv.due_date ? new Date(inv.due_date) : null;
    if (!due) {
      console.log(`[LATEFEE] Skip invoice ${inv._id}: no due_date`);
      continue;
    }

    // Apply grace: fees start after grace days from due_date
    const feeStart = addDays(due, (Number(policy.gracePeriodDays) || 0) + 1);

    // Determine effective overdue window within last month
    const effectiveStart = feeStart > periodStart ? feeStart : periodStart;
    let effectiveEnd = periodEnd;
    if (inv.paid_at) {
      const paidAt = new Date(inv.paid_at);
      if (paidAt < effectiveStart) {
        // Fully paid before accrual window
        console.log(`[LATEFEE] Skip ${inv._id}: paid_at ${paidAt.toISOString()} before effectiveStart ${effectiveStart.toISOString()}`);
        continue;
      }
      if (paidAt < effectiveEnd) effectiveEnd = paidAt;
    }

    if (effectiveEnd < effectiveStart) {
      console.log(`[LATEFEE] Skip ${inv._id}: effectiveEnd ${effectiveEnd.toISOString()} < effectiveStart ${effectiveStart.toISOString()}`);
      continue;
    }

    const overdueDays = diffDaysInclusive(effectiveEnd, effectiveStart);
    if (overdueDays <= 0) {
      console.log(`[LATEFEE] Skip ${inv._id}: overdueDays <= 0`);
      continue;
    }

    // Outstanding approximation: use current balance if unpaid else 0
    const outstanding = Number(inv.balance ?? Math.max(0, (inv.total || 0) - (inv.amount_paid || 0)));
    if (outstanding <= 0) {
      console.log(`[LATEFEE] Skip ${inv._id}: outstanding <= 0 (balance=${inv.balance}, total=${inv.total}, paid=${inv.amount_paid})`);
      continue; // nothing to charge
    }

    // Compute amount using policy
    const vars = { ...policy.variables, overdueDays, outstanding };
    let amount = 0;
    try {
      amount = evaluateLateFeeAmount({ formula: policy.customFormula, variables: vars });
    } catch (e) {
      console.error(`Late fee formula error for invoice ${inv._id}:`, e.message);
      // Skip this invoice in case of formula error
      continue;
    }

    const maxCap = Number(vars.maxCap || 0);
    if (maxCap > 0) amount = Math.min(amount, maxCap);

    if (amount <= 0) {
      console.log(`[LATEFEE] Skip ${inv._id}: computed amount <= 0 (overdueDays=${overdueDays}, outstanding=${outstanding})`);
      continue;
    }

    const ratePerDay = Math.round((amount / overdueDays) * 100) / 100;

    // Upsert provisional late fee invoice (local only, never pushed)
    const base = {
      client: contract.client._id,
      contract: contract._id,
      building: contract.building?._id || buildingDoc._id,
      type: 'late_fee',
      category: 'monthly',
      date: periodEnd,
      due_date: null,
      line_items: [
        {
          description: `Late fee for ${inv.invoice_number || inv._id} (${periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}): ${overdueDays} day(s)`,
          quantity: overdueDays,
          unitPrice: ratePerDay,
          amount: Math.round(amount * 100) / 100,
          name: 'Late Fee',
          rate: ratePerDay,
          unit: 'day',
          item_total: Math.round(amount * 100) / 100
        }
      ],
      sub_total: Math.round(amount * 100) / 100,
      tax_total: 0,
      total: Math.round(amount * 100) / 100,
      amount_paid: 0,
      balance: Math.round(amount * 100) / 100,
      status: 'draft',
      push_to_zoho: false,
      late_fee: {
        original_invoice: inv._id,
        period_year: year,
        period_month: month,
        days: overdueDays,
        amount: Math.round(amount * 100) / 100,
        rate_per_day: ratePerDay,
        variables_snapshot: vars,
        formula_snapshot: policy.customFormula || 'dailyFlat * overdueDays',
        status: 'pending_merge'
      }
    };

    // Idempotent upsert using unique index on (original_invoice, year, month, type)
    const existing = await Invoice.findOne({ type: 'late_fee', 'late_fee.original_invoice': inv._id, 'late_fee.period_year': year, 'late_fee.period_month': month });
    if (!existing) {
      await Invoice.create(base);
      created++;
    } else if (existing.late_fee?.status === 'pending_merge') {
      // Update amount/days if formula or balances changed
      existing.line_items = base.line_items;
      existing.sub_total = base.sub_total;
      existing.total = base.total;
      existing.balance = base.balance;
      existing.late_fee.days = overdueDays;
      existing.late_fee.amount = base.late_fee.amount;
      existing.late_fee.rate_per_day = ratePerDay;
      existing.late_fee.variables_snapshot = vars;
      existing.late_fee.formula_snapshot = base.late_fee.formula_snapshot;
      await existing.save();
      updated++;
    }
  }

  console.log(`[LATEFEE] Contract ${contract._id}: checked=${checked}, created=${created}, updated=${updated}`);
  return { created, updated, checked };
}

async function collectPendingLateFeeLineItems(contract) {
  // Collect all pending provisional late fee invoices for this client+contract (up to last month)
  const refDate = new Date();
  const { year, month } = getLastMonthPeriod(refDate);

  const pending = await Invoice.find({
    client: contract.client._id,
    contract: contract._id,
    type: 'late_fee',
    'late_fee.status': 'pending_merge',
    'late_fee.period_year': { $lte: year },
    $or: [
      { 'late_fee.period_year': { $lt: year } },
      { 'late_fee.period_year': year, 'late_fee.period_month': { $lte: month } }
    ]
  });

  const lineItems = [];
  for (const p of pending) {
    const li = p.line_items?.[0];
    if (!li) continue;
    lineItems.push({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
      name: 'Late Fee',
      rate: li.unitPrice,
      unit: 'day',
      item_total: li.amount,
      __provisionalId: p._id
    });
  }

  return { lineItems, provisionalIds: pending.map(p => p._id) };
}

/**
 * Create a monthly invoice for a specific contract
 */
async function createMonthlyInvoiceForContract(contract, { issueDate, dueDate } = {}) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  // Check if invoice already exists for this month
  const billingPeriodStart = new Date(currentYear, currentMonth, 1);
  const billingPeriodEnd = new Date(currentYear, currentMonth + 1, 0); // Last day of current month

  const existingInvoice = await Invoice.findOne({
    contract: contract._id,
    "billing_period.start": billingPeriodStart,
    "billing_period.end": billingPeriodEnd
  });

  // If an invoice already exists for this period, try merging any pending late fees into it (if still draft)
  if (existingInvoice) {
    try {
      const clientDoc = contract.client;
      const buildingDoc = contract.building;
      // Ensure provisional late fees are up-to-date for last month
      try { await upsertProvisionalLateFeesForLastMonth(contract, clientDoc, buildingDoc); } catch (_) { }
      const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(contract);

      if (Array.isArray(lineItems) && lineItems.length > 0 && existingInvoice.status === 'draft') {
        // Append late fee line items
        for (const li of lineItems) {
          existingInvoice.line_items.push({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.amount,
            name: 'Late Fee',
            rate: li.unitPrice,
            unit: 'day',
            item_total: li.amount
          });
        }

        // Recompute totals with 18% GST
        const newSubTotal = existingInvoice.line_items.reduce((s, it) => s + Number(it.item_total ?? it.amount ?? 0), 0);
        const newTaxTotal = round2(newSubTotal * 0.18);
        const newTotal = round2(newSubTotal + newTaxTotal);
        existingInvoice.sub_total = round2(newSubTotal);
        existingInvoice.tax_total = newTaxTotal;
        existingInvoice.total = newTotal;
        const paid = Number(existingInvoice.amount_paid || 0);
        existingInvoice.balance = Math.max(0, round2(newTotal - paid));

        await existingInvoice.save();

        // Mark provisional late fees as merged into this invoice
        if (provisionalIds && provisionalIds.length > 0) {
          await Invoice.updateMany(
            { _id: { $in: provisionalIds } },
            { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_invoice': existingInvoice._id, 'late_fee.merged_at': new Date() } }
          );
        }

        console.log(`Appended ${lineItems.length} late fee item(s) into existing invoice ${existingInvoice._id}`);
      } else {
        if (!lineItems || lineItems.length === 0) {
          console.log(`No pending provisional late fees to merge for contract ${contract._id}`);
        } else if (existingInvoice.status !== 'draft') {
          console.log(`Existing invoice ${existingInvoice._id} is not draft; skipping late fee merge`);
        }
      }
    } catch (mergeErr) {
      console.error(`Error merging late fees into existing invoice ${existingInvoice._id}:`, mergeErr?.message || mergeErr);
    }
    return existingInvoice;
  }

  // Skip if this is the first month and contract started mid-month (already has prorated invoice)
  const contractStartDate = new Date(contract.startDate);
  const isFirstMonth = contractStartDate.getMonth() === currentMonth &&
    contractStartDate.getFullYear() === currentYear;

  if (isFirstMonth && contractStartDate.getDate() !== 1) {
    console.log(`Skipping monthly invoice for contract ${contract._id} - first month already has prorated invoice`);
    return null;
  }

  // Prepare late fees: upsert provisional for last month, then collect pending
  const clientDoc = contract.client; // populated
  const buildingDoc = contract.building; // populated (partial)
  try {
    await upsertProvisionalLateFeesForLastMonth(contract, clientDoc, buildingDoc);
  } catch (lfErr) {
    console.error(`Late fee upsert error for contract ${contract._id}:`, lfErr?.message || lfErr);
  }

  let lateFeeLineItems = [];
  let mergedProvisionalIds = [];
  try {
    const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(contract);
    lateFeeLineItems = lineItems;
    mergedProvisionalIds = provisionalIds;
  } catch (collectErr) {
    console.error(`Late fee collect error for contract ${contract._id}:`, collectErr?.message || collectErr);
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
    items.push({
      description: `Monthly Rent - ${monthName}`,
      quantity: 1,
      unitPrice: rentAmount,
      amount: rentAmount,
      name: `Monthly Rent - ${monthName}`,
      rate: rentAmount,
      unit: "nos",
      item_total: rentAmount
    });
    subtotal += rentAmount;
  }

  // Append late fee line items (if any)
  for (const li of lateFeeLineItems) {
    items.push({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
      name: 'Late Fee',
      rate: li.unitPrice,
      unit: 'day',
      item_total: li.amount
    });
    subtotal += Number(li.amount || 0);
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
      item_total: item.amount
    })),

    sub_total: round2(subtotal),
    tax_total: taxTotal,
    total,
    amount_paid: 0,
    balance: total,
    status: "draft",
    notes: `Monthly invoice for ${billingPeriodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,

    // Zoho Books specific fields
    currency_code: "INR",
    exchange_rate: 1,
    gst_treatment: "business_gst",
    place_of_supply: "MH",
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

    customer_id: contract.client.zohoBooksContactId,
    gst_no: contract.client.gstNo
  };

  const invoice = await Invoice.create(invoiceData);

  console.log(`Created monthly invoice ${invoice._id} for contract ${contract._id}`);

  // Mark provisional late fees as merged into this invoice
  if (mergedProvisionalIds.length > 0) {
    await Invoice.updateMany(
      { _id: { $in: mergedProvisionalIds } },
      { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_invoice': invoice._id, 'late_fee.merged_at': new Date() } }
    );
  }

  // Push to Zoho Books if client is synced
  try {
    if (contract.client.zohoBooksContactId) {
      const { createZohoInvoiceFromLocal } = await import("../utils/zohoBooks.js");
      const zohoResponse = await createZohoInvoiceFromLocal(invoice.toObject(), contract.client.toObject());
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

export const createMonthlyInvoicesConsolidated = async () => {
  const results = { created: 0, errors: 0, details: [] };
  try {
    const now = new Date();

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
      .populate('client')
      .populate('building', 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay lateFeePolicy');

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
    const billingPeriodStart = new Date(currentYear, currentMonth, 1);
    const billingPeriodEnd = new Date(currentYear, currentMonth + 1, 0);

    for (const [key, group] of groups) {
      const { building, client, contracts } = group;
      try {
        const { shouldGenerateToday, issueDate, dueDate } = getInvoiceScheduleForBuilding(building, now);
        if (!shouldGenerateToday) {
          results.details.push({ group: key, status: 'skipped', reason: 'Not scheduled today for this building' });
          continue;
        }

        // Idempotency: check if consolidated exists for this client+building+period
        let existing = await Invoice.findOne({
          client: client._id,
          building: building._id,
          'billing_period.start': billingPeriodStart,
          'billing_period.end': billingPeriodEnd,
          type: 'regular',
          category: 'monthly'
        }).select('_id status');
        if (existing) {
          // Try to merge pending late fees from all contracts if invoice is still draft
          try {
            if (existing.status === 'draft') {
              let appended = 0;
              let provisionalToMark = [];
              for (const c of contracts) {
                try { await upsertProvisionalLateFeesForLastMonth(c, client, building); } catch (_) { }
                const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(c);
                if (Array.isArray(lineItems) && lineItems.length > 0) {
                  for (const li of lineItems) {
                    existing.line_items.push({
                      description: li.description,
                      quantity: li.quantity,
                      unitPrice: li.unitPrice,
                      amount: li.amount,
                      name: 'Late Fee',
                      rate: li.unitPrice,
                      unit: 'day',
                      item_total: li.amount
                    });
                  }
                  appended += lineItems.length;
                  provisionalToMark.push(...provisionalIds);
                }
              }

              if (appended > 0) {
                const newSubTotal = existing.line_items.reduce((s, it) => s + Number(it.item_total ?? it.amount ?? 0), 0);
                const newTaxTotal = round2(newSubTotal * 0.18);
                const newTotal = round2(newSubTotal + newTaxTotal);
                existing.sub_total = round2(newSubTotal);
                existing.tax_total = newTaxTotal;
                existing.total = newTotal;
                const paid = Number(existing.amount_paid || 0);
                existing.balance = Math.max(0, round2(newTotal - paid));
                await existing.save();

                if (provisionalToMark.length > 0) {
                  await Invoice.updateMany(
                    { _id: { $in: provisionalToMark } },
                    { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_invoice': existing._id, 'late_fee.merged_at': new Date() } }
                  );
                }
              }
            }
            results.details.push({ group: key, status: 'exists', invoiceId: existing._id });
          } catch (mergeErr) {
            results.errors++;
            results.details.push({ group: key, status: 'error', error: mergeErr?.message || String(mergeErr) });
          }
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
        const monthName = billingPeriodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

        for (const c of contracts) {
          // First month rule: if started mid-month of current month, skip rent line (prorated handled elsewhere)
          const start = new Date(c.startDate);
          const isFirstMonth = start.getMonth() === currentMonth && start.getFullYear() === currentYear;
          if (isFirstMonth && start.getDate() !== 1) {
            continue;
          }
          const rentAmount = Number(c.monthlyRent || 0);
          if (rentAmount > 0) {
            const contractLabel = String(c.contractNumber || c._id).slice(-6);
            items.push({
              description: `Monthly Subscription - ${monthName} (Contract ${contractLabel})`,
              quantity: 1,
              unitPrice: rentAmount,
              amount: rentAmount,
              name: `Monthly Subscription - ${monthName}`,
              rate: rentAmount,
              unit: 'nos',
              item_total: rentAmount
            });
            subtotal += rentAmount;
          }
        }

        // Late fee items across contracts
        let allProvisionalIds = [];
        for (const c of contracts) {
          try { await upsertProvisionalLateFeesForLastMonth(c, client, building); } catch (_) { }
          try {
            const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(c);
            for (const li of lineItems) {
              items.push({
                description: li.description,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                amount: li.amount,
                name: 'Late Fee',
                rate: li.unitPrice,
                unit: 'day',
                item_total: li.amount
              });
              subtotal += Number(li.amount || 0);
            }
            allProvisionalIds.push(...provisionalIds);
          } catch (e) {
            console.error('Late fee collect error:', e?.message || String(e));
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
            item_total: item.amount
          })),
          sub_total: round2(subtotal),
          tax_total: taxTotal,
          total,
          amount_paid: 0,
          balance: total,
          status: 'draft',
          notes: `Monthly consolidated invoice for ${billingPeriodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: 'MH',
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
          gst_no: client.gstNo
        };

        const invoice = await Invoice.create(invoiceData);

        // Mark provisional late fees as merged
        if (allProvisionalIds.length > 0) {
          await Invoice.updateMany(
            { _id: { $in: allProvisionalIds } },
            { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_invoice': invoice._id, 'late_fee.merged_at': new Date() } }
          );
        }

        // Push to Zoho
        try {
          if (client.zohoBooksContactId) {
            const { createZohoInvoiceFromLocal } = await import('../utils/zohoBooks.js');
            const zohoResponse = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject());
            const inv = zohoResponse.invoice || zohoResponse;
            if (inv && inv.invoice_id) {
              invoice.zoho_invoice_id = inv.invoice_id;
              invoice.zoho_invoice_number = inv.invoice_number;
              invoice.zoho_status = inv.status || inv.status_formatted;
              invoice.zoho_pdf_url = inv.pdf_url;
              invoice.invoice_url = inv.invoice_url;
              await invoice.save();
            }
          }
        } catch (zohoErr) {
          console.error(`Failed to push consolidated invoice ${invoice._id} to Zoho Books:`, zohoErr?.message || String(zohoErr));
        }

        results.created++;
        results.details.push({ group: key, status: 'success', invoiceId: invoice._id });
      } catch (error) {
        console.error('Error in consolidated monthly invoice generation:', error);
        throw error;
      }
    }

    return results;
  } catch (error) {
    console.error('Error in consolidated monthly invoice generation:', error);
    throw error;
  }
};

export const createMonthlyEstimates = async () => {
  const results = { created: 0, skipped: 0, errors: 0, details: [] };
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const periodStart = new Date(currentYear, currentMonth, 1);
    const periodEnd = new Date(currentYear, currentMonth + 1, 0);

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
      .populate('client')
      .populate('building', 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay');

    for (const contract of activeContracts) {
      try {
        const building = contract.building;
        if (!building) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'No building' });
          continue;
        }

        // Defer until first billable month (billingStartDate || startDate)
        const firstBillDate = contract.billingStartDate ? new Date(contract.billingStartDate) : new Date(contract.startDate);
        const fbYear = firstBillDate.getFullYear();
        const fbMonth = firstBillDate.getMonth();
        const isBeforeFirstBillMonth = (currentYear < fbYear) || (currentYear === fbYear && currentMonth < fbMonth);
        if (isBeforeFirstBillMonth) {
          results.skipped++; results.details.push({ contractId: contract._id, status: 'skipped', reason: 'Before first billable month' });
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
          items.push({
            description: `Monthly Subscription - ${monthName}`,
            quantity: 1,
            unitPrice: rentAmount,
            amount: rentAmount,
            name: `Monthly Subscription - ${monthName}`,
            rate: rentAmount,
            unit: 'nos',
            item_total: rentAmount
          });
          subtotal += rentAmount;
        }

        // --- Start of late fee logic ---
        let allProvisionalIds = [];
        try { await upsertProvisionalLateFeesForLastMonth(contract, contract.client, building); } catch (_) { }
        try {
          const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(contract);
          for (const li of lineItems) {
            items.push({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              amount: li.amount,
              name: 'Late Fee',
              rate: li.unitPrice,
              unit: 'day',
              item_total: li.amount
            });
            subtotal += Number(li.amount || 0);
          }
          allProvisionalIds.push(...provisionalIds);
        } catch (e) {
          console.error(`Late fee collect error for contract ${contract._id}:`, e?.message || String(e));
        }
        // --- End of late fee logic ---

        const taxRate = 18;
        const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
        const total = Math.round((subtotal + taxTotal) * 100) / 100;

        const estimateDoc = await Estimate.create({
          client: contract.client._id,
          contract: contract._id,
          building: building._id,
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
            item_total: it.amount
          })),
          sub_total: Math.round(subtotal * 100) / 100,
          tax_total: taxTotal,
          total,
          status: 'draft',
          notes: `Monthly Pro Forma for ${periodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: 'MH',
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
          customer_id: contract.client.zohoBooksContactId,
          gst_no: contract.client.gstNo
        });

        // Mark provisional late fees as merged
        if (allProvisionalIds.length > 0) {
          await Invoice.updateMany(
            { _id: { $in: allProvisionalIds } },
            { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_estimate': estimateDoc._id, 'late_fee.merged_at': new Date() } }
          );
        }

        // Push to Zoho as estimate (draft)
        try {
          if (contract.client.zohoBooksContactId) {
            const { createZohoEstimateFromLocal, fetchZohoEstimatePdfBinary } = await import('../utils/zohoBooks.js');
            const zohoResp = await createZohoEstimateFromLocal(estimateDoc.toObject(), contract.client.toObject());

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

/**
 * Create consolidated monthly estimates per client+building
 * Groups active contracts by (building, client) and creates one estimate with a line per contract
 * Schedule and idempotency mirror consolidated invoices logic
 */
export const createMonthlyEstimatesConsolidated = async () => {
  const results = { created: 0, skipped: 0, errors: 0, details: [] };
  try {
    const now = new Date();
    // Generate ONLY for next month's period
    const baseYear = now.getFullYear();
    const baseMonth = now.getMonth();
    const currentYear = baseMonth === 11 ? baseYear + 1 : baseYear;
    const currentMonth = (baseMonth + 1) % 12;
    const periodStart = new Date(currentYear, currentMonth, 1);
    const periodEnd = new Date(currentYear, currentMonth + 1, 0);

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
      .populate('client')
      .populate('building', 'name address draftInvoiceGeneration draftInvoiceDay draftInvoiceDueDay');

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
        const monthName = periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

        for (const c of contracts) {
          // Defer until first billable month (billingStartDate || startDate)
          const firstBillDate = c.billingStartDate ? new Date(c.billingStartDate) : new Date(c.startDate);
          const fbYear = firstBillDate.getFullYear();
          const fbMonth = firstBillDate.getMonth();
          const isBeforeFirstBillMonth = (currentYear < fbYear) || (currentYear === fbYear && currentMonth < fbMonth);
          if (isBeforeFirstBillMonth) continue;

          // No proration: if first billable month starts mid-month, skip in that first month
          const isFirstBillMonth = fbYear === currentYear && fbMonth === currentMonth;
          if (isFirstBillMonth && firstBillDate.getDate() !== 1) continue;

          const rentAmount = Number(c.monthlyRent || 0);
          if (rentAmount > 0) {
            const contractLabel = String(c.contractNumber || c._id).slice(-6);
            items.push({
              description: `Monthly Subscription - ${monthName} (Contract ${contractLabel})`,
              quantity: 1,
              unitPrice: rentAmount,
              amount: rentAmount,
              name: `Monthly Subscription - ${monthName}`,
              rate: rentAmount,
              unit: 'nos',
              item_total: rentAmount
            });
            subtotal += rentAmount;
          }
        }

        // --- Start of late fee logic ---
        let allProvisionalIds = [];
        for (const c of contracts) {
          try { await upsertProvisionalLateFeesForLastMonth(c, client, building); } catch (_) { }
          try {
            const { lineItems, provisionalIds } = await collectPendingLateFeeLineItems(c);
            for (const li of lineItems) {
              items.push({
                description: li.description,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                amount: li.amount,
                name: 'Late Fee',
                rate: li.unitPrice,
                unit: 'day',
                item_total: li.amount
              });
              subtotal += Number(li.amount || 0);
            }
            allProvisionalIds.push(...provisionalIds);
          } catch (e) {
            console.error('Late fee collect error in consolidated:', e?.message || String(e));
          }
        }
        // --- End of late fee logic ---

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
          building: building._id,
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
            item_total: it.amount
          })),
          sub_total: Math.round(subtotal * 100) / 100,
          tax_total: taxTotal,
          total,
          status: 'draft',
          notes: `Monthly Pro Forma (Consolidated) for ${periodStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
          currency_code: 'INR',
          exchange_rate: 1,
          gst_treatment: 'business_gst',
          place_of_supply: 'MH',
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

        // Mark provisional late fees as merged
        if (allProvisionalIds.length > 0) {
          await Invoice.updateMany(
            { _id: { $in: allProvisionalIds } },
            { $set: { 'late_fee.status': 'merged', 'late_fee.merged_into_estimate': estimateDoc._id, 'late_fee.merged_at': new Date() } }
          );
        }

        // Push to Zoho (non-blocking)

        // Push to Zoho (non-blocking)
        try {
          if (client.zohoBooksContactId) {
            const { createZohoEstimateFromLocal, fetchZohoEstimatePdfBinary } = await import('../utils/zohoBooks.js');
            const zohoResp = await createZohoEstimateFromLocal(estimateDoc.toObject(), client.toObject());

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

export default { createMonthlyInvoices, createMonthlyInvoicesConsolidated, createMonthlyEstimates, createMonthlyEstimatesConsolidated };
