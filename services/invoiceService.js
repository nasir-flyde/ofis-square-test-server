import Invoice from "../models/invoiceModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";

/**
 * Auto-create invoice from contract when it becomes active
 * @param {string} contractId - Contract ObjectId
 * @param {object} options - Configuration options
 * @returns {object} Created invoice
 */
export const createInvoiceFromContract = async (contractId, options = {}) => {
  const {
    issueOn = "activation",
    prorate = true,
    includeDeposit = true,
    dueDays = 7,
    taxRate = 18
  } = options;

  try {
    // Load contract with populated data
    const contract = await Contract.findById(contractId)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) {
      throw new Error("Contract not found");
    }

    // Check if invoice already exists for this contract and period
    const period = getInvoicePeriod(contract.startDate);
    const startEnd = getBillingPeriodRange(contract.startDate, contract.endDate);
    const existingInvoice = await Invoice.findOne({ 
      contract: contractId,
      "billingPeriod.start": startEnd.start,
      "billingPeriod.end": startEnd.end
    });

    if (existingInvoice) {
      console.log(`Invoice already exists for contract ${contractId}`);
      return existingInvoice;
    }

    const issueDate = new Date();
    // Set due date to the last day of the billing month
    const dueDate = new Date(startEnd.end);

    const items = [];
    let subtotal = 0;

    // Add prorated monthly rent
    if (contract.monthlyRent > 0) {
      const rentItem = calculateProratedRent(contract, prorate, taxRate);
      items.push({
        description: rentItem.description,
        quantity: 1,
        unitPrice: contract.monthlyRent,
        amount: rentItem.total
      });
      subtotal += rentItem.total;
    }

    // Add security deposit
    if (includeDeposit && contract.securityDeposit > 0) {
      const depositItem = {
        description: "Security Deposit (refundable)",
        quantity: 1,
        unitPrice: contract.securityDeposit,
        amount: contract.securityDeposit
      };
      items.push(depositItem);
      subtotal += depositItem.amount;
    }

    // Calculate taxes (apply tax only on rent item; deposit non-taxable)
    const taxableAmount = items.reduce((sum, item) => {
      if (item.description.toLowerCase().includes("rent")) return sum + item.amount;
      return sum;
    }, 0);
    const taxes = taxRate > 0 ? [{ name: "GST", rate: taxRate, amount: round2(taxableAmount * (taxRate / 100)) }] : [];
    const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
    const total = round2(subtotal + taxTotal);

    // Create invoice payload
    const invoiceNumber = await generateInvoiceNumber(period);
    const invoiceData = {
      invoiceNumber,
      client: contract.client._id,
      contract: contractId,
      building: contract.building._id,
      issueDate,
      dueDate,
      billingPeriod: startEnd,
      items,
      subtotal: round2(subtotal),
      taxes,
      total,
      amountPaid: 0,
      balanceDue: total,
      status: "issued",
      notes: `Auto-created from contract (${issueOn})`
    };

    // Create the invoice
    const invoice = await Invoice.create(invoiceData);
    
    console.log(`Auto-created invoice ${invoice._id} for contract ${contractId}`);
    return invoice;

  } catch (error) {
    console.error("Error creating invoice from contract:", error);
    throw error;
  }
};

/**
 * Calculate prorated rent for the first month
 */
function calculateProratedRent(contract, prorate, taxRate) {
  const startDate = new Date(contract.startDate);
  const monthlyRent = contract.monthlyRent;
  
  let total = monthlyRent;
  let description = `Monthly Rent - ${startDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  let prorationData = { enabled: false };

  if (prorate && startDate.getDate() !== 1) {
    // Calculate proration
    const year = startDate.getFullYear();
    const month = startDate.getMonth();
    const periodDays = new Date(year, month + 1, 0).getDate(); // Days in month
    const usedDays = periodDays - startDate.getDate() + 1;
    const proratedAmount = (monthlyRent * usedDays) / periodDays;
    
    total = Math.round(proratedAmount * 100) / 100;
    description = `Monthly Rent - ${startDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} (prorated ${usedDays}/${periodDays} days)`;
    prorationData = {
      enabled: true,
      usedDays: usedDays,
      periodDays: periodDays,
      proratedAmount: total
    };
  }

  return {
    description: description,
    total: total
  };
}

/**
 * Get invoice period string (YYYY-MM format)
 */
function getInvoicePeriod(startDate) {
  const date = new Date(startDate);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid startDate for period: ${startDate}`);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getBillingPeriodRange(startDate, endDate) {
  // Ensure we have valid dates
  const s = new Date(startDate);
  if (isNaN(s.getTime())) {
    throw new Error(`Invalid startDate: ${startDate}`);
  }
  
  const periodStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  // Always set end date to last day of the month
  const monthEnd = new Date(s.getFullYear(), s.getMonth() + 1, 0);
  
  // For invoice creation, always use the last day of the month as end date
  let periodEnd = monthEnd;
  
  return { start: periodStart, end: periodEnd };
}

async function generateInvoiceNumber(period) {
  const prefix = `INV-${period}-`;
  
  // Retry up to 5 times to handle race conditions
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      // Get the highest existing sequence number for this period
      const lastInvoice = await Invoice.findOne(
        { invoiceNumber: { $regex: `^${prefix}` } },
        { invoiceNumber: 1 }
      ).sort({ invoiceNumber: -1 });
      
      let nextSeq = 1;
      if (lastInvoice) {
        const lastSeq = parseInt(lastInvoice.invoiceNumber.split('-').pop());
        nextSeq = lastSeq + 1;
      }
      
      const invoiceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
      
      // Check if this number already exists (race condition check)
      const exists = await Invoice.findOne({ invoiceNumber });
      if (!exists) {
        return invoiceNumber;
      }
      
      // If it exists, try again with a small delay
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
  
  // Fallback: use timestamp suffix
  const timestamp = Date.now().toString().slice(-4);
  return `${prefix}${timestamp}`;
}

function round2(n) { return Math.round(n * 100) / 100; }
export default { createInvoiceFromContract };
