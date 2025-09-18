import Invoice from "../models/invoiceModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";

/**
 * Create monthly invoices for all active contracts
 * This runs on the 1st of every month to generate invoices for the current month
 */
export const createMonthlyInvoices = async () => {
  const results = { created: 0, errors: 0, details: [] };
  
  try {
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
    .populate("building", "name address pricing");

    console.log(`Found ${activeContracts.length} active contracts for monthly billing`);

    for (const contract of activeContracts) {
      try {
        await createMonthlyInvoiceForContract(contract);
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

/**
 * Create a monthly invoice for a specific contract
 */
async function createMonthlyInvoiceForContract(contract) {
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

  if (existingInvoice) {
    console.log(`Invoice already exists for contract ${contract._id} for ${currentYear}-${currentMonth + 1}`);
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

  // Create full monthly invoice
  const issueDate = new Date(currentYear, currentMonth, 1); // 1st of current month
  const dueDate = new Date(currentYear, currentMonth + 1, 2); // 2nd of next month
  
  const items = [];
  let subtotal = 0;

  if (contract.monthlyRent > 0) {
    const monthName = issueDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    items.push({
      description: `Monthly Rent - ${monthName}`,
      quantity: 1,
      unitPrice: contract.monthlyRent,
      amount: contract.monthlyRent
    });
    subtotal += contract.monthlyRent;
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
    date: issueDate,
    due_date: dueDate,
    billing_period: {
      start: billingPeriodStart,
      end: billingPeriodEnd
    },
    
    line_items: items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      name: item.description,
      rate: item.unitPrice,
      unit: "nos",
      item_total: item.amount
    })),
    
    sub_total: round2(subtotal),
    tax_total: taxTotal,
    total,
    amount_paid: 0,
    balance: total,
    status: "draft",
    notes: `Monthly invoice for ${issueDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
    
    // Zoho Books specific fields
    currency_code: "INR",
    exchange_rate: 1,
    gst_treatment: "business_gst",
    place_of_supply: "MH",
    payment_terms: 7,
    payment_terms_label: "Net 7",
    
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

export default { createMonthlyInvoices };
