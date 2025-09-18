import Invoice from "../models/invoiceModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
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
    dueDays = 7,
    taxRate = 18
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
      "billingPeriod.start": startEnd.start,
      "billingPeriod.end": startEnd.end
    });

    if (existingInvoice) {
      console.log(`Invoice already exists for contract ${contractId}`);
      return existingInvoice;
    }


    const issueDate = new Date(contract.startDate);
    // Set due date to 2nd of next month
    const startDate = new Date(contract.startDate);
    const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 2); // 2nd of next month

    const items = [];
    let subtotal = 0;

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

    const taxableAmount = items.reduce((sum, item) => {
      if (item.description.toLowerCase().includes("rent")) return sum + item.amount;
      return sum;
    }, 0);
    const taxes = taxRate > 0 ? [{ name: "GST", rate: taxRate, amount: round2(taxableAmount * (taxRate / 100)) }] : [];
    const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
    const total = round2(subtotal + taxTotal);

    // Create invoice payload
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
      tax_total: taxes.reduce((s, t) => s + t.amount, 0),
      total,
      amount_paid: 0,
      balance: total,
      status: "draft", // Start as draft for Zoho compatibility
      notes: `Auto-created from contract (${issueOn})`,
      
      // Zoho Books specific fields
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: "business_gst", // Default for business clients
      place_of_supply: "MH", // Default to Maharashtra, should be configurable
      payment_terms: 7, // 7 days payment terms
      payment_terms_label: "Net 7",
      
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
      gst_no: contract.client.gstNo
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
function calculateProratedRent(contract, prorate, taxRate) {
  const startDate = new Date(contract.startDate);
  const monthlyRent = contract.monthlyRent;
  
  let total = monthlyRent;
  let description = `Monthly Rent - ${startDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  let prorationData = { enabled: false };

  if (prorate && startDate.getDate() !== 1) {
    // Calculate proration based on remaining days in the month
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


function round2(n) { return Math.round(n * 100) / 100; }
export default { createInvoiceFromContract };
