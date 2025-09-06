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

    // Check if invoice already exists for this contract
    const existingInvoice = await Invoice.findOne({ 
      contractId: contractId,
      "references.period": getInvoicePeriod(contract.contractStartDate)
    });

    if (existingInvoice) {
      console.log(`Invoice already exists for contract ${contractId}`);
      return existingInvoice;
    }

    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dueDays);

    const items = [];
    let subtotal = 0;

    // Add prorated monthly rent
    if (contract.monthlyRent > 0) {
      const rentItem = calculateProratedRent(contract, prorate, taxRate);
      items.push(rentItem);
      subtotal += rentItem.total;
    }

    // Add security deposit
    if (includeDeposit && contract.securityDeposit > 0) {
      const depositItem = {
        code: "DEPOSIT",
        description: "Security Deposit (refundable)",
        quantity: 1,
        unitPrice: contract.securityDeposit,
        taxRate: 0, // Usually non-taxable
        total: contract.securityDeposit
      };
      items.push(depositItem);
      subtotal += depositItem.total;
    }

    // Calculate taxes
    const taxTotal = items.reduce((sum, item) => {
      return sum + (item.total * (item.taxRate / 100));
    }, 0);

    const grandTotal = subtotal + taxTotal;

    // Create invoice payload
    const invoiceData = {
      clientId: contract.client._id,
      contractId: contractId,
      currency: "INR",
      issueDate: issueDate,
      dueDate: dueDate,
      status: "pending",
      references: {
        period: getInvoicePeriod(contract.contractStartDate),
        issueOn: issueOn,
        notes: "Auto-created from contract activation"
      },
      items: items,
      totals: {
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100
      },
      meta: {
        buildingId: contract.building._id,
        capacity: contract.capacity,
        monthlyRent: contract.monthlyRent,
        securityDeposit: contract.securityDeposit,
        startDate: contract.contractStartDate,
        endDate: contract.contractEndDate,
        prorationApplied: prorate
      }
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
  const startDate = new Date(contract.contractStartDate);
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
    code: "RENT",
    description: description,
    quantity: 1,
    unitPrice: monthlyRent,
    proration: prorationData,
    taxRate: taxRate,
    total: total
  };
}

/**
 * Get invoice period string (YYYY-MM format)
 */
function getInvoicePeriod(startDate) {
  const date = new Date(startDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default { createInvoiceFromContract };
