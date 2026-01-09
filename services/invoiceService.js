import Invoice from "../models/invoiceModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import Estimate from "../models/estimateModel.js";
import { generateLocalInvoiceNumber, getInvoicePeriod } from "../utils/invoiceNumberGenerator.js";

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
    dueDays = 7
  } = options;

  try {
    const contract = await Contract.findById(contractId)
      .populate("client")
      .populate("building", "name address pricing");

    if (!contract) {
      throw new Error("Contract not found");
    }
    const startEnd = getBillingPeriodRange(contract.startDate, contract.endDate);
    const existingInvoice = await Invoice.findOne({ 
      contract: contractId,
      type: 'regular',
      "billing_period.start": startEnd.start,
      "billing_period.end": startEnd.end
    });

    if (existingInvoice) {
      console.log(`Invoice already exists for contract ${contractId}`);
      return existingInvoice;
    }


    const issueDate = new Date(contract.startDate);
    // Set due date based on building.draftInvoiceDueDay (day-of-month), defaulting to 7
    const startDate = new Date(contract.startDate);
    let buildingDueDay = 7;
    try {
      const bDoc = await Building.findById(contract.building._id).select('draftInvoiceDueDay');
      if (bDoc && Number(bDoc.draftInvoiceDueDay) > 0) {
        buildingDueDay = Number(bDoc.draftInvoiceDueDay);
      }
    } catch (e) {
      console.warn('Failed to load building invoice settings, using defaults:', e?.message || e);
    }
    const firstOfNextMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
    const daysInNextMonth = new Date(firstOfNextMonth.getFullYear(), firstOfNextMonth.getMonth() + 1, 0).getDate();
    const dueDay = Math.max(1, Math.min(buildingDueDay, daysInNextMonth));
    const dueDate = new Date(firstOfNextMonth.getFullYear(), firstOfNextMonth.getMonth(), dueDay);
    
    console.log(`Invoice dates - Issue: ${issueDate.toISOString().slice(0, 10)}, Due: ${dueDate.toISOString().slice(0, 10)} (dueDay=${buildingDueDay})`);

    const items = [];
    let subtotal = 0;

    if (contract.monthlyRent > 0) {
      const rentItem = calculateProratedRent(contract, prorate);
      items.push({
        description: rentItem.description,
        quantity: 1,
        unitPrice: rentItem.total, // Use prorated amount as unit price
        amount: rentItem.total
      });
      subtotal += rentItem.total;
    }

    const taxTotal = 0;
    const total = round2(subtotal + taxTotal);

    const invoiceNumber = await generateLocalInvoiceNumber();
    const invoiceData = {
      // Updated field names to match new schema
      invoice_number: invoiceNumber,
      client: contract.client._id,
      contract: contractId,
      building: contract.building._id,
      date: issueDate,
      due_date: dueDate,
      billing_period: startEnd,
      
      // Map items to new line_items structure with Zoho fields
      line_items: items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        // Zoho Books fields
        name: item.description,
        rate: item.unitPrice,
        unit: "nos",
        item_total: item.amount
      })),
      
      sub_total: round2(subtotal),
      tax_total: taxTotal,
      total,
      amount_paid: 0,
      balance: round2(Math.max(0, total)),
      status: "draft", // Start as draft for Zoho compatibility
      notes: `Auto-created from contract (${issueOn})`,
      
      // Zoho Books specific fields
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: "business_gst", // Default for business clients
      place_of_supply: "MH", // Default to Maharashtra, should be configurable
      // Compute payment terms from issue->due difference
      payment_terms: Math.max(0, Math.round((dueDate - issueDate) / (1000 * 60 * 60 * 24))),
      payment_terms_label: `Net ${Math.max(0, Math.round((dueDate - issueDate) / (1000 * 60 * 60 * 24)))}`,
      
      // Client address mapping (if available)
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
      
      // Map customer for Zoho integration
      customer_id: contract.client.zohoBooksContactId, // Will be populated when client is synced to Zoho
      gst_no: contract.client.gstNo,
    };

    const invoice = await Invoice.create(invoiceData);
    
    console.log(`Auto-created invoice ${invoice._id} for contract ${contractId}`);
    
    // Immediately push to Zoho Books on contract activation (requested behavior)
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
          
          console.log(`Pushed invoice ${invoice._id} to Zoho Books at activation: ${invoiceData.invoice_id}`);
        } else {
          console.warn(`Zoho Books did not return invoice_id for invoice ${invoice._id}`);
        }
      } else {
        console.log(`Skipping Zoho push for invoice ${invoice._id} - client has no zohoBooksContactId`);
      }
    } catch (zohoError) {
      console.error(`Failed to push invoice ${invoice._id} to Zoho Books at activation:`, zohoError.message);
      // Do not fail contract activation if Zoho push fails
    }
    
    return invoice;

  } catch (error) {
    console.error("Error creating invoice from contract:", error);
    throw error;
  }
};

/**
 * Calculate prorated rent for the first month
 */
function calculateProratedRent(contract, prorate) {
  const startDate = new Date(contract.startDate);
  const monthlyRent = contract.monthlyRent;
  
  let total = monthlyRent;
  let description = `Monthly Subscription - ${startDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  let prorationData = { enabled: false };

  if (prorate) {
    // Always prorate based on remaining days in the month from start date
    const year = startDate.getFullYear();
    const month = startDate.getMonth();
    const periodDays = new Date(year, month + 1, 0).getDate(); // Total days in month
    const remainingDays = periodDays - startDate.getDate() + 1; // Days from start date to end of month
    const proratedAmount = (monthlyRent * remainingDays) / periodDays;
    
    total = Math.round(proratedAmount * 100) / 100;
    description = `Monthly Rent - ${startDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} (prorated ${remainingDays}/${periodDays} days)`;
    prorationData = {
      enabled: true,
      remainingDays: remainingDays,
      periodDays: periodDays,
      proratedAmount: total
    };
  }

  return {
    description: description,
    total: total
  };
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


/**
 * Create credit purchase invoice
 * @param {object} params - Invoice parameters
 * @param {string} params.clientId - Client ObjectId
 * @param {number} params.credits - Number of credits purchased
 * @param {object} params.options - Invoice options
 * @returns {object} Created invoice
 */
export const createCreditPurchaseInvoice = async ({ clientId, credits, options = {} }) => {
  const {
    description = 'Credits Purchase',
    taxable = true,
    gstRate = 18,
    invoiceDate = new Date(),
    dueDate = null,
    notes = '',
    idempotencyKey = null
  } = options;

  try {
    // Get client and contract for credit value
    const client = await Client.findById(clientId);
    if (!client) {
      throw new Error('Client not found');
    }

    const contract = await Contract.findOne({ 
      client: clientId, 
      status: 'active' 
    }).sort({ createdAt: -1 });

    if (!contract) {
      throw new Error('No active contract found for client');
    }

    const creditValue = contract.credit_value || 500; // Default ₹500 per credit

    // Check for existing invoice with same idempotency key
    if (idempotencyKey) {
      const existingInvoice = await Invoice.findOne({
        client: clientId,
        type: 'credit_purchase',
        idempotencyKey
      });
      if (existingInvoice) {
        return existingInvoice;
      }
    }

    // Calculate amounts
    const subtotal = credits * creditValue;
    const taxAmount = taxable ? subtotal * (gstRate / 100) : 0;
    const total = subtotal + taxAmount;

    // Set due date (default to 7 days from invoice date)
    const finalDueDate = dueDate || new Date(invoiceDate.getTime() + (7 * 24 * 60 * 60 * 1000));

    const invoiceNumber = await generateLocalInvoiceNumber();

    // Create line items
    const lineItems = [{
      description: `${description} (${credits} credits @ ₹${creditValue}/credit)`,
      quantity: credits,
      unitPrice: creditValue,
      amount: subtotal,
      name: description,
      rate: creditValue,
      unit: 'credits',
      item_total: subtotal
    }];

    // Create invoice data
    const invoiceData = {
      invoice_number: invoiceNumber,
      client: clientId,
      contract: contract._id,
      building: contract.building,
      date: invoiceDate,
      due_date: finalDueDate,
      type: 'credit_purchase',
      
      line_items: lineItems,
      
      sub_total: round2(subtotal),
      tax_total: round2(taxAmount),
      total: round2(total),
      amount_paid: 0,
      balance: round2(total),
      status: 'draft',
      notes: notes || `Credit purchase: ${credits} credits`,
      
      // Zoho Books fields
      currency_code: 'INR',
      exchange_rate: 1,
      gst_treatment: 'business_gst',
      place_of_supply: 'MH',
      payment_terms: 7,
      payment_terms_label: 'Net 7',
      
      // Client address mapping
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
      idempotencyKey
    };

    // Add taxes if applicable
    if (taxable && taxAmount > 0) {
      invoiceData.taxes = [{
        name: 'GST',
        rate: gstRate,
        amount: round2(taxAmount)
      }];
    }

    const invoice = await Invoice.create(invoiceData);
    
    console.log(`Created credit purchase invoice ${invoice._id} for ${credits} credits`);
    
    return invoice;

  } catch (error) {
    console.error('Error creating credit purchase invoice:', error);
    throw error;
  }
};

/**
 * Preview credit purchase invoice totals
 * @param {string} clientId - Client ObjectId
 * @param {number} credits - Number of credits
 * @param {object} options - Preview options
 * @returns {object} Preview totals
 */
export const previewCreditPurchaseInvoice = async (clientId, credits, options = {}) => {
  const { taxable = true, gstRate = 18 } = options;

  try {
    const contract = await Contract.findOne({ 
      client: clientId, 
      status: 'active' 
    }).sort({ createdAt: -1 });

    if (!contract) {
      throw new Error('No active contract found for client');
    }

    const creditValue = contract.credit_value || 500;
    const subtotal = credits * creditValue;
    const taxAmount = taxable ? subtotal * (gstRate / 100) : 0;
    const total = subtotal + taxAmount;

    return {
      credits,
      creditValue,
      subtotal: round2(subtotal),
      taxAmount: round2(taxAmount),
      total: round2(total),
      taxable,
      gstRate
    };

  } catch (error) {
    console.error('Error previewing credit purchase invoice:', error);
    throw error;
  }
};

export const createEstimateFromContract = async (contractId, options = {}) => {
  const {
    issueOn = "activation",
    prorate = true
  } = options;

  try {
    const contract = await Contract.findById(contractId)
      .populate("client")
      .populate("building", "name address draftInvoiceDueDay");

    if (!contract) {
      throw new Error("Contract not found");
    }

    // Determine first billable date: billingStartDate takes precedence over startDate
    const firstBillDate = contract.billingStartDate ? new Date(contract.billingStartDate) : new Date(contract.startDate);

    // If first billable month is in the future, defer to cron (do not create now)
    const now = new Date();
    const isFutureMonth = (
      firstBillDate.getFullYear() > now.getFullYear() ||
      (firstBillDate.getFullYear() === now.getFullYear() && firstBillDate.getMonth() > now.getMonth())
    );
    if (isFutureMonth) {
      return { deferred: true, reason: "First billable month is in the future; will be generated by monthly schedule" };
    }

    // Estimate issue date should be the billingStartDate (or startDate when billingStartDate is absent)
    const issueDate = new Date(firstBillDate);

    // Compute expiry date based on building.draftInvoiceDueDay (day-of-month of next month), default 7
    let buildingDueDay = 7;
    try {
      const bDoc = await Building.findById(contract.building._id).select('draftInvoiceDueDay');
      if (bDoc && Number(bDoc.draftInvoiceDueDay) > 0) {
        buildingDueDay = Number(bDoc.draftInvoiceDueDay);
      }
    } catch (_) {}
    const firstOfNextMonth = new Date(issueDate.getFullYear(), issueDate.getMonth() + 1, 1);
    const daysInNextMonth = new Date(firstOfNextMonth.getFullYear(), firstOfNextMonth.getMonth() + 1, 0).getDate();
    const dueDay = Math.max(1, Math.min(buildingDueDay, daysInNextMonth));
    const expiryDate = new Date(firstOfNextMonth.getFullYear(), firstOfNextMonth.getMonth(), dueDay);

    // Billing period for first month: start at firstBillDate, end at last day of that month
    const periodStart = new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate());
    const periodEnd = new Date(issueDate.getFullYear(), issueDate.getMonth() + 1, 0);

    // Prepare line items (reuse prorate logic)
    const items = [];
    let subtotal = 0;

    if (contract.monthlyRent > 0) {
      let rentTotal = contract.monthlyRent;
      let description = `Monthly Rent - ${issueDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;

      if (prorate) {
        // Reuse existing prorate helper with a cloned contract using firstBillDate
        const clone = {
          ...contract.toObject(),
          startDate: issueDate,
          monthlyRent: contract.monthlyRent
        };
        const rentItem = calculateProratedRent(clone, true);
        rentTotal = rentItem.total;
        description = rentItem.description;
      }

      items.push({
        description,
        quantity: 1,
        unitPrice: rentTotal,
        amount: rentTotal,
        name: description,
        rate: rentTotal,
        unit: "nos",
        item_total: rentTotal
      });
      subtotal += rentTotal;
    }

    // Apply 18% GST to estimates as preview of payable
    const taxRate = 18;
    const taxTotal = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + taxTotal) * 100) / 100;

    // Create Estimate (no local estimate_number sequencing required; Zoho can assign)
    const estimateData = {
      client: contract.client._id,
      contract: contract._id,
      building: contract.building._id,
      date: issueDate,
      expiry_date: expiryDate,
      billing_period: { start: periodStart, end: periodEnd },

      line_items: items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        name: item.name,
        rate: item.unitPrice,
        unit: item.unit || 'nos',
        item_total: item.amount
      })),

      sub_total: Math.round(subtotal * 100) / 100,
      tax_total: taxTotal,
      total,
      status: "draft",
      notes: `Pro Forma for ${issueDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} (created on ${issueOn})`,

      // Tax/Zoho fields similar to invoices
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: "business_gst",
      place_of_supply: "MH",

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

    const estimate = await Estimate.create(estimateData);

    // Push to Zoho as estimate (draft) if client is linked
    try {
      if (contract.client.zohoBooksContactId) {
        const { createZohoEstimateFromLocal } = await import("../utils/zohoBooks.js");
        const zohoResp = await createZohoEstimateFromLocal(estimate.toObject(), contract.client.toObject());
        const data = zohoResp?.estimate || zohoResp;
        const zId = data?.estimate_id || data?.estimate?.estimate_id;
        if (zId) {
          estimate.zoho_estimate_id = zId;
          estimate.zoho_estimate_number = data?.estimate_number || estimate.zoho_estimate_number;
          estimate.zoho_status = data?.status || estimate.zoho_status;
          estimate.zoho_pdf_url = data?.pdf_url || estimate.zoho_pdf_url;
          estimate.estimate_url = data?.estimate_url || estimate.estimate_url;
          await estimate.save();
        }
      }
    } catch (e) {
      console.warn("Failed to push estimate to Zoho (non-blocking):", e?.message || e);
    }

    return estimate;
  } catch (error) {
    console.error("Error creating estimate from contract:", error);
    throw error;
  }
};

export const createBillingDocumentFromContract = async (contractId, options = {}) => {
  if (process.env.BILLING_MODE === 'estimate') {
    return await createEstimateFromContract(contractId, options);
  }
  return await createInvoiceFromContract(contractId, options);
};

function round2(n) { return Math.round(n * 100) / 100; }

export default { 
  createInvoiceFromContract, 
  createCreditPurchaseInvoice, 
  previewCreditPurchaseInvoice,
  createEstimateFromContract,
  createBillingDocumentFromContract
};
