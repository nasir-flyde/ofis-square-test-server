import Invoice from "../models/invoiceModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Payment from "../models/paymentModel.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import { getValidAccessToken } from "../utils/zohoTokenManager.js";
import axios from "axios";
import { logCRUDActivity, logPaymentActivity, logErrorActivity, logSystemActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import PdfPrinter from "pdfmake";
import getInvoiceTemplate from "./invoiceTemplate.js";
import {
  createZohoInvoiceFromLocal,
  getZohoInvoice,
  getZohoInvoicePdfUrl,
  getZohoInvoiceLinks,
  fetchZohoInvoicePdfBinary,
  recordZohoPayment,
  sendZohoInvoiceEmail,
  findOrCreateContactFromClient,
  markZohoInvoiceAsSent,
  createContact as createZohoContact,
} from "../utils/zohoBooks.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";

// Helper: compute totals (recomputes amounts to be safe)
function computeTotals(payload) {
  const srcItems = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : (Array.isArray(payload.line_items) ? payload.line_items : []);
  const items = srcItems.map((it) => {
    const quantity = Number(it.quantity || 0);
    const unitPrice = Number(it.unitPrice || it.rate || 0);
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    return { description: it.description, quantity, unitPrice, amount };
  });
  const subtotal = Math.round(items.reduce((sum, i) => sum + Number(i.amount || 0), 0) * 100) / 100;

  const discount = payload.discount || { type: "flat", value: 0 };
  let discountAmount = 0;
  if (discount.type === "percent") {
    discountAmount = Math.round(((subtotal * Number(discount.value || 0)) / 100) * 100) / 100;
  } else {
    discountAmount = Number(discount.value || 0);
  }
  if (discountAmount < 0) discountAmount = 0;
  if (discountAmount > subtotal) discountAmount = subtotal;

  const taxableBase = subtotal - discountAmount;

  const taxes = (payload.taxes || []).map((t) => {
    const rate = Number(t.rate || 0);
    const amount = Math.round(((taxableBase * rate) / 100) * 100) / 100;
    return { name: t.name, rate, amount };
  });
  const taxesTotal = Math.round(taxes.reduce((sum, t) => sum + Number(t.amount || 0), 0) * 100) / 100;

  const total = Math.max(0, Math.round((taxableBase + taxesTotal) * 100) / 100);
  const amountPaid = Number(payload.amountPaid || 0);
  const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);

  return {
    items,
    subtotal,
    discount: { type: discount.type || "flat", value: Number(discount.value || 0), amount: discountAmount },
    taxes,
    total,
    amountPaid,
    balanceDue,
  };
}

export const createInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    const { client, contract, billingPeriod, issueDate, dueDate, notes, meta } = body;

    if (!client) return res.status(400).json({ success: false, message: "client is required" });
    if (!billingPeriod || !billingPeriod.start || !billingPeriod.end) {
      return res.status(400).json({ success: false, message: "billingPeriod.start and billingPeriod.end are required" });
    }

    const [clientDoc, contractDoc] = await Promise.all([
      Client.findById(client),
      contract ? Contract.findById(contract) : Promise.resolve(null),
    ]);
    if (!clientDoc) return res.status(404).json({ success: false, message: "Client not found" });
    if (contract && !contractDoc) return res.status(404).json({ success: false, message: "Contract not found" });

    // Role-based restrictions: Finance Junior can only create draft invoices
    const userRole = req.userRole?.roleName || "";
    let invoiceStatus = body.status || "draft";
    
    if (userRole === "finance_junior" && invoiceStatus !== "draft") {
      return res.status(403).json({ 
        success: false, 
        message: "Finance Junior users can only create draft invoices. Please contact Finance Senior to send invoices." 
      });
    }

    const localInvoiceNumber = body.localInvoiceNumber || (await generateLocalInvoiceNumber());
    const totals = computeTotals(body);

    // Determine building for TDS: prefer contract.building, then client.building, then body.building
    let buildingId = undefined;
    if (contractDoc?.building) buildingId = contractDoc.building;
    else if (clientDoc?.building) buildingId = clientDoc.building;
    else if (body.building) buildingId = body.building;

    // Resolve GST/tax info from request body or client's taxInfoList/client fields
    const taxList = Array.isArray(clientDoc?.taxInfoList) ? clientDoc.taxInfoList : [];
    const primaryTax = taxList.find((t) => t?.is_primary) || taxList[0] || null;
    const resolvedGSTNo = body.gst_no || body.gstNo || primaryTax?.tax_registration_no || clientDoc.gstNo || clientDoc.gstNumber || undefined;
    const resolvedPlaceOfSupply = body.place_of_supply || body.placeOfSupply || primaryTax?.place_of_supply || clientDoc?.billingAddress?.state_code || clientDoc?.billingAddress?.state || undefined;
    const resolvedGstTreatment = body.gst_treatment || body.gstTreatment || clientDoc.gstTreatment || "business_gst";

    // Create invoice data using same structure as createInvoiceFromContract
    const invoiceData = {
      invoice_number: localInvoiceNumber,
      client,
      contract: contract || undefined,
      building: buildingId || undefined,
      date: issueDate ? new Date(issueDate) : new Date(),
      due_date: dueDate ? new Date(dueDate) : undefined,
      billing_period: {
        start: new Date(billingPeriod.start),
        end: new Date(billingPeriod.end),
      },

      line_items: totals.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        name: item.description,
        rate: item.unitPrice,
        unit: "nos",
        item_total: item.amount,
      })),

      sub_total: totals.subtotal,
      tax_total: totals.taxes.reduce((sum, t) => sum + t.amount, 0),
      total: totals.total,
      amount_paid: totals.amountPaid,
      balance: Math.max(0, Number(totals.total || 0) - Number(totals.amountPaid || 0)),
      status: invoiceStatus,
      notes: notes || "Manual invoice creation",
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: resolvedGstTreatment,
      place_of_supply: resolvedPlaceOfSupply,
      payment_terms: 7,
      payment_terms_label: "Net 7",
      ...(clientDoc.billingAddress && {
        billing_address: {
          attention: clientDoc.contactPerson,
          address: clientDoc.billingAddress.address,
          city: clientDoc.billingAddress.city,
          state: clientDoc.billingAddress.state,
          zip: clientDoc.billingAddress.zip,
          country: clientDoc.billingAddress.country || "IN",
          phone: clientDoc.phone,
        },
      }),
      customer_id: clientDoc.zohoBooksContactId,
      gst_no: resolvedGSTNo,
      ...(meta ? { meta } : {}),
    };

    const invoice = await Invoice.create(invoiceData);

    // Log activity
    await logCRUDActivity(req, "CREATE", "Invoice", invoice._id, null, {
      invoiceNumber: invoice.invoice_number,
      clientId: invoice.client,
      totalAmount: invoice.total,
    });

    console.log(`Manual invoice ${invoice._id} created locally with number ${localInvoiceNumber}`);
    // Note: Invoices are now created locally only. Use "Push to Zoho" button to sync with Zoho Books.

    return res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate local invoice number or Zoho invoice ID" });
    }
    await logErrorActivity(req, error, "Invoice Creation");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadEInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await Invoice.findById(id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    let eUrl = req.body?.fileUrl || req.body?.url;
    const files = Array.isArray(req.files) ? req.files : [];
    if (!eUrl && files.length > 0) {
      const f = files[0];
      const result = await imagekit.upload({
        file: f.buffer,
        fileName: f.originalname || `e_invoice_${id}_${Date.now()}`,
        folder: "/invoices/e-invoices"
      });
      eUrl = result?.url;
    }

    if (!eUrl) return res.status(400).json({ success: false, message: 'Provide file (multipart) or fileUrl in body' });

    inv.e_invoice_url = eUrl;
    await inv.save();

    await logCRUDActivity(req, 'UPDATE', 'Invoice', inv._id, null, { e_invoice_url: true });
    return res.json({ success: true, data: inv });
  } catch (error) {
    await logErrorActivity(req, error, 'Upload E-Invoice');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id).populate("client", "companyName email");

    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    const data = {
      invoiceNumber: invoice.invoice_number,
      issueDate: invoice.date,
      dueDate: invoice.due_date,
      client: invoice.client || {},
      billingPeriod: invoice.billing_period || {},
      items: invoice.line_items || [],
      subtotal: invoice.sub_total || 0,
      discount: invoice.discount || { type: "flat", value: 0, amount: 0 },
      taxes: invoice.taxes || [],
      total: invoice.total || 0,
      amountPaid: invoice.amount_paid || 0,
      balanceDue: invoice.balance || 0,
      notes: invoice.notes || "",
    };

    const docDefinition = getInvoiceTemplate(data);
    const printer = new PdfPrinter(getFonts());
    const pdfDoc = printer.createPdfKitDocument(docDefinition, { defaultStyle: { font: "Helvetica" } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice_${invoice.invoice_number || id}.pdf"`
    );

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error("downloadInvoicePdf error:", error);
    await logErrorActivity(req, error, "Download Invoice PDF");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const pushInvoiceToZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendStatus } = req.body; // 'draft' or 'sent'
    
    // Role-based restriction: Only Finance Senior can push as 'sent'
    const userRole = req.userRole?.roleName || "";
    if (sendStatus === 'sent') {
      if (userRole !== "System Admin") {
        return res.status(403).json({
          success: false,
          message: "Only Finance Senior users can send invoices in Zoho Books. Please contact your Finance Senior."
        });
      }
    }
    
    const invoice = await Invoice.findById(id).populate("client");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (invoice.zoho_invoice_id) {
      // Invoice already exists in Zoho, but if sendStatus is 'sent', attempt to send it
      if (sendStatus === 'sent') {
        // Check if invoice is still in draft status in Zoho
        if (invoice.zoho_status === 'draft' || invoice.status === 'draft') {
          // Attempt to send the existing draft invoice
          const client = invoice.client || await Client.findById(invoice.client);
          if (!client) {
            return res.status(400).json({ success: false, message: "Invoice has no linked client" });
          }

          if (!client.email) {
            return res.status(400).json({
              success: false,
              message: 'Cannot send invoice: Client has no email address'
            });
          }

          try {
            console.log(`Sending existing draft invoice ${invoice._id} to client email: ${client.email}`);
            await sendZohoInvoiceEmail(invoice.zoho_invoice_id, {
              to_mail_ids: [client.email],
              subject: `Invoice ${invoice.invoice_number || invoice.zoho_invoice_number}`,
              body: 'Please find attached your invoice.'
            });

            // Update the status to sent
            invoice.status = 'sent';
            invoice.sent_at = new Date();
            invoice.zoho_status = 'sent';
            await invoice.save();

            console.log(`✅ Invoice ${invoice._id} was already in Zoho but sent to client ${client.email}`);

            return res.json({
              success: true,
              data: invoice,
              message: "Invoice sent to client from existing Zoho draft",
              zoho_invoice_id: invoice.zoho_invoice_id,
              sent: true
            });
          } catch (emailError) {
            console.error(`❌ Failed to send existing draft invoice email:`, emailError.message);
            return res.status(400).json({
              success: false,
              message: `Failed to send draft invoice to client: ${emailError.message}`
            });
          }
        } else {
          // Invoice is already sent, return with message
          return res.json({
            success: true,
            data: invoice,
            message: "Invoice already linked to Zoho Books and already sent",
            zoho_invoice_id: invoice.zoho_invoice_id,
          });
        }
      } else {
        // For draft status, just return the existing invoice info
        return res.json({
          success: true,
          data: invoice,
          message: "Invoice already linked to Zoho Books",
          zoho_invoice_id: invoice.zoho_invoice_id,
        });
      }
    }

    // Ensure invoice has a client and Zoho contact
    let client = invoice.client ? invoice.client : await Client.findById(invoice.client);
    
    // If no client found and clientId provided in request body, use that
    if (!client && req.body.clientId) {
      client = await Client.findById(req.body.clientId);
      if (client) {
        // Update invoice with the client
        invoice.client = client._id;
        await invoice.save();

    // If this invoice is linked to a contract, check if all invoices for that contract are paid
    try {
      if (invoice.contract) {
        const remaining = await Invoice.countDocuments({ contract: invoice.contract, status: { $ne: 'paid' } });
        if (remaining === 0) {
          await Contract.findByIdAndUpdate(invoice.contract, { isfinalapproval: true }, { new: true });
          await logCRUDActivity(req, 'UPDATE', 'Contract', invoice.contract, null, {
            isfinalapproval: true,
            reason: 'All invoices paid'
          });
        }
      }
    } catch (flagErr) {
      console.warn('Failed to set contract.isfinalapproval on payment:', flagErr?.message || flagErr);
    }
      }
    }
    
    if (!client) {
      return res.status(400).json({ success: false, message: "Invoice has no linked client or client not found" });
    }

    try {
      if (!client.zohoBooksContactId) {
        const contactId = await findOrCreateContactFromClient(client);
        if (!contactId) {
          return res.status(400).json({ success: false, message: "Failed to find or create Zoho contact for client" });
        }
        client.zohoBooksContactId = contactId;
        await client.save();
      }

      // Enrich invoice document with GST context if missing
      try {
        const invObj = invoice.toObject();
        const hasZeroTax = typeof invObj.tax_total === 'number' && Number(invObj.tax_total) <= 0;
        // Prefer client-provided GST treatment; else infer: if client has gstNo then business_gst else consumer
        const inferredTreatment = client.gstTreatment || (client.gstNo ? 'business_gst' : 'consumer');
        invObj.gst_treatment = invObj.gst_treatment || inferredTreatment;
        // Place of supply from invoice or client billing address
        const placeOfSupply = invObj.place_of_supply
          || client.place_of_supply
          || client?.billingAddress?.state_code
          || client?.billingAddress?.state
          || undefined;
        if (placeOfSupply) invObj.place_of_supply = placeOfSupply;
        // GST number
        invObj.gst_no = invObj.gst_no || client.gstNo || undefined;
        // Provide org state code for interstate decision (read from env)
        invObj.organization_state_code = process.env.ZOHO_ORG_STATE_CODE || process.env.ZOHO_BOOKS_ORG_STATE_CODE || undefined;
        // If zero-tax and no exemption configured, relax to consumer to avoid IGST enforcement
        if (hasZeroTax && invObj.gst_treatment === 'business_gst' && !process.env.ZOHO_TAX_EXEMPTION_ID) {
          invObj.gst_treatment = 'consumer';
        }

        // Create Zoho invoice from local invoice (robust IGST/CGST handling lives here)
        const zohoResp = await createZohoInvoiceFromLocal(invObj, client.toObject());
        const zohoId = zohoResp?.invoice?.invoice_id;
        const zohoNumber = zohoResp?.invoice?.invoice_number;
        if (!zohoId) {
          return res.status(400).json({ success: false, message: "Zoho did not return an invoice_id", details: zohoResp });
        }

        invoice.zoho_invoice_id = zohoId;
        invoice.zoho_invoice_number = zohoNumber || invoice.zoho_invoice_number;
        invoice.source = invoice.source || "zoho";
        
        await invoice.save();
      } catch (zErr) {
        await logErrorActivity(req, zErr, "Push Invoice to Zoho");
        return res.status(400).json({ success: false, message: zErr.message });
      }

      // After pushing invoice to Zoho, also push any associated payments
      try {
        const payments = await Payment.find({ invoice: id }).populate('client');
        
        if (payments && payments.length > 0) {
          console.log(`Found ${payments.length} payment(s) for invoice ${id}, pushing to Zoho...`);
          
          for (const payment of payments) {
            // Skip if payment already has zoho_payment_id
            if (payment.zoho_payment_id) {
              console.log(`Payment ${payment._id} already synced to Zoho, skipping`);
              continue;
            }

            // Fetch the Zoho invoice to get the actual balance
            const zohoInvoiceDetails = await getZohoInvoice(invoice.zoho_invoice_id);
            const zohoBalance = Number(zohoInvoiceDetails?.balance || zohoInvoiceDetails?.total || 0);
            const paymentAmount = Number(payment.amount || 0);
            
            // Only apply up to the balance due in Zoho
            const amountToApply = Math.min(paymentAmount, zohoBalance);
            
            if (amountToApply <= 0) {
              console.log(`Payment ${payment._id} amount is 0 or invoice already paid in Zoho, skipping`);
              continue;
            }

            // Prepare Zoho payment payload
            const zohoPaymentPayload = {
              customer_id: client.zohoBooksContactId,
              payment_mode: payment.type || 'cash',
              amount: amountToApply,
              date: payment.paymentDate ? new Date(payment.paymentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              invoices: [{
                invoice_id: invoice.zoho_invoice_id,
                amount_applied: amountToApply
              }],
              reference_number: payment.referenceNumber || payment.paymentGatewayRef || '',
              description: payment.notes || `Payment for invoice ${invoice.invoice_number}`
            };

            // Push payment to Zoho Books
            const accessToken = await getValidAccessToken();
            const orgId = process.env.ZOHO_ORG_ID;
            
            if (orgId && accessToken) {
              const zohoUrl = `https://www.zohoapis.in/books/v3/customerpayments?organization_id=${orgId}`;
              const zohoPaymentResponse = await fetch(zohoUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(zohoPaymentPayload)
              });

              const zohoPaymentData = await zohoPaymentResponse.json();

              if (zohoPaymentResponse.ok && zohoPaymentData.payment) {
                // Update local payment with Zoho data
                payment.zoho_payment_id = zohoPaymentData.payment.payment_id;
                payment.payment_number = zohoPaymentData.payment.payment_number;
                payment.zoho_status = zohoPaymentData.payment.status;
                payment.source = 'zoho_books';
                await payment.save();
                console.log(`✅ Payment ${payment._id} pushed to Zoho with ID: ${zohoPaymentData.payment.payment_id}`);
              } else {
                console.warn(`⚠️ Failed to push payment ${payment._id} to Zoho:`, zohoPaymentData.message || 'Unknown error');
              }
            }
          }
        }
      } catch (paymentPushError) {
        console.warn('Failed to push payments to Zoho (non-blocking):', paymentPushError.message);
        // Don't fail the invoice push if payment push fails
      }
      
      // If user chose to send, update status and send email
      if (sendStatus === 'sent') {
        console.log(`Attempting to send invoice ${invoice._id} to client email: ${client.email}`);
        
        if (!client.email) {
          console.error(`Cannot send invoice - client has no email address`);
          invoice.status = 'draft';
          await invoice.save();
          return res.status(400).json({ 
            success: false, 
            message: 'Cannot send invoice: Client has no email address. Invoice pushed as draft.' 
          });
        }
        
        try {
          // Send the invoice via Zoho
          console.log(`Sending invoice email via Zoho to ${client.email}`);
          await sendZohoInvoiceEmail(invoice.zoho_invoice_id, {
            to_mail_ids: [client.email],
            subject: `Invoice ${invoice.invoice_number || invoice.zoho_invoice_number}`,
            body: 'Please find attached your invoice.'
          });
          
          invoice.status = 'sent';
          invoice.sent_at = new Date();
          invoice.zoho_status = 'sent';
          await invoice.save();
          console.log(`✅ Invoice ${invoice._id} pushed to Zoho and sent to client ${client.email}`);
          
          return res.json({ 
            success: true, 
            data: invoice, 
            zoho_invoice_id: invoice.zoho_invoice_id,
            zoho_invoice_number: invoice.zoho_invoice_number,
            sent: true
          });
        } catch (emailError) {
          console.error(`❌ Failed to send invoice email:`, emailError.message);
          console.error('Email error details:', emailError);
          // Still save the invoice but keep as draft
          invoice.status = 'draft';
          await invoice.save();
          return res.status(400).json({ 
            success: false, 
            message: `Invoice pushed to Zoho but failed to send email: ${emailError.message}` 
          });
        }
      } else {
        // Keep as draft (just pushed to Zoho, not sent)
        console.log(`Invoice ${invoice._id} pushed to Zoho as draft`);
        invoice.status = 'draft';
        invoice.zoho_status = 'draft';
        await invoice.save();
      }

      return res.json({ 
        success: true, 
        data: invoice, 
        zoho_invoice_id: invoice.zoho_invoice_id,
        zoho_invoice_number: invoice.zoho_invoice_number,
        sent: invoice.status === 'sent'
      });
    } catch (err) {
      await logErrorActivity(req, err, "Push Invoice to Zoho");
      return res.status(400).json({ success: false, message: err.message });
    }
  } catch (error) {
    await logErrorActivity(req, error, "Push Invoice to Zoho");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const sendInvoiceEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, customMessage } = req.body || {};
    
    // Role-based restriction: Only Finance Senior can send invoices
    const userRole = req.userRole?.roleName || "";
    if (userRole === "System Admin") {
      return res.status(403).json({ 
        success: false, 
        message: "Only Finance Senior users can send invoices. Please contact your Finance Senior." 
      });
    }
    
    const invoice = await Invoice.findById(id).populate("client", "email");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const payload = { to: to || invoice?.client?.email, subject, body: customMessage };
    const resp = await sendZohoInvoiceEmail(invoice.zoho_invoice_id, payload);
    invoice.sent_at = new Date();
    invoice.zoho_status = "sent";
    invoice.status = "sent";
    await invoice.save();

    // Log system activity for Zoho integration
    await logSystemActivity("INVOICE_SENT", "Invoice", invoice._id, `Invoice ${invoice.invoice_number} sent to Zoho Books`, {
      zohoInvoiceId: invoice.zoho_invoice_id,
      totalAmount: invoice.total,
    });

    return res.json({ success: true, data: invoice, zoho: resp });
  } catch (error) {
    await logErrorActivity(req, error, "Send Invoice Email");
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

export const syncInvoiceFromZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const zInv = await getZohoInvoice(invoice.zoho_invoice_id);
    if (zInv) {
      invoice.zoho_status = zInv.status || zInv.status_formatted || invoice.zoho_status;
      invoice.zoho_pdf_url = zInv.pdf_url || invoice.zoho_pdf_url;
      invoice.invoice_url = zInv.invoice_url || invoice.invoice_url;
      if (typeof zInv.balance === "number" && typeof zInv.total === "number") {
        invoice.amount_paid = Math.max(0, Number(zInv.total) - Number(zInv.balance));
        invoice.balance = Number(zInv.balance);
        if (invoice.balance === 0) invoice.paid_at = invoice.paid_at || new Date();
        invoice.status = invoice.balance === 0 ? "paid" : invoice.status;
      }
      await invoice.save();
    }
    return res.json({ success: true, data: invoice, zoho: zInv });
  } catch (error) {
    await logErrorActivity(req, error, "Sync Invoice from Zoho");
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

export const getInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const url = await getZohoInvoicePdfUrl(invoice.zoho_invoice_id);
    return res.json({ success: true, data: { pdfUrl: url } });
  } catch (error) {
    await logErrorActivity(req, error, "Get Invoice PDF");
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

// GET /api/invoices/:id/zoho-pdf
// Streams the PDF bytes fetched from Zoho bulk PDF endpoint using the Zoho invoice ID
export const getInvoiceZohoPdfBinary = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id).select("zoho_invoice_id invoice_number");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const { buffer, contentType, contentDisposition } = await fetchZohoInvoicePdfBinary(invoice.zoho_invoice_id);
    res.setHeader("Content-Type", contentType || "application/pdf");
    // Prefer Zoho's disposition; otherwise set a filename using our invoice number/id
    res.setHeader(
      "Content-Disposition",
      contentDisposition || `attachment; filename="invoice_${invoice.invoice_number || id}.pdf"`
    );
    return res.status(200).send(buffer);
  } catch (error) {
    await logErrorActivity(req, error, "Get Zoho Invoice PDF Binary");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/invoices/:id/zoho-links
export const getInvoiceZohoLinks = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id).select("zoho_invoice_id");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    const links = await getZohoInvoiceLinks(invoice.zoho_invoice_id);
    return res.json({ success: true, data: links });
  } catch (error) {
    await logErrorActivity(req, error, "Get Zoho Invoice Links");
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

// POST /api/invoices/:id/payments
export const recordInvoicePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, payment_mode, reference_number, tax_deducted, tax_amount_withheld } = req.body || {};
    if (!amount) return res.status(400).json({ success: false, message: "amount is required" });
    const withheld = Boolean(tax_deducted) ? Number(tax_amount_withheld || 0) : 0;
    if (withheld < 0) return res.status(400).json({ success: false, message: "tax_amount_withheld must be >= 0" });
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    if (!invoice.zoho_invoice_id) return res.status(400).json({ success: false, message: "Invoice not synced to Zoho yet" });

    // Create local payment record first (single-invoice mode)
    const payment = await Payment.create({
      invoice: id,
      client: invoice.client,
      amount: Number(amount),
      paymentDate: date ? new Date(date) : new Date(),
      type: payment_mode || "Bank Transfer",
      referenceNumber: reference_number || `PAY-${Date.now()}`,
      source: "manual",
      invoices: [{ invoice: id, amount_applied: Number(amount), tax_deducted: Boolean(tax_deducted), tax_amount_withheld: withheld }],
      tax_deducted: Boolean(tax_deducted),
      tax_amount_withheld: withheld,
      tax_amount_withheld_total: withheld,
      applied_total: Number(amount),
      unused_amount: 0,
    });

    // Push only cash amount to Zoho Books
    const zohoResp = await recordZohoPayment(invoice.zoho_invoice_id, { amount, date, payment_mode, reference_number });
    if (zohoResp?.payment?.payment_id) {
      payment.zoho_payment_id = zohoResp.payment.payment_id;
      payment.payment_number = zohoResp.payment.payment_number;
      payment.zoho_status = zohoResp.payment.status;
      await payment.save();
    }

    // Update invoice totals: cash applied + withheld reduce balance
    invoice.amount_paid = Math.max(0, Number(invoice.amount_paid || 0) + Number(amount));
    invoice.tax_withheld_total = Math.max(0, Number(invoice.tax_withheld_total || 0) + Number(withheld));
    invoice.balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0) - Number(invoice.tax_withheld_total || 0));
    if (invoice.balance === 0) {
      invoice.status = "paid";
      invoice.paid_at = new Date();
    }
    await invoice.save();

    // Update linked security deposit if this is a deposit invoice
    try { await applyPaymentToDeposit(id, Number(amount)); } catch (_) {}

    // If this invoice is linked to a contract, check if all invoices for that contract are paid
    try {
      if (invoice.contract) {
        const remaining = await Invoice.countDocuments({ contract: invoice.contract, status: { $ne: 'paid' } });
        if (remaining === 0) {
          await Contract.findByIdAndUpdate(invoice.contract, { isfinalapproval: true }, { new: true });
          await logCRUDActivity(req, 'UPDATE', 'Contract', invoice.contract, null, {
            isfinalapproval: true,
            reason: 'All invoices paid'
          });
        }
      }
    } catch (flagErr) {
      console.warn('Failed to set contract.isfinalapproval on payment:', flagErr?.message || flagErr);
    }

    // Log payment activity
    await logPaymentActivity(req, "PAYMENT_MADE", "Invoice", invoice._id, {
      paymentId: payment?._id,
      amount, // cash applied
      tax_deducted: Boolean(tax_deducted),
      tax_amount_withheld: withheld,
      paymentMode: payment_mode,
      referenceNumber: reference_number,
    });

    return res.json({ success: true, data: invoice, payment, zoho: zohoResp });
  } catch (error) {
    await logErrorActivity(req, error, "Record Invoice Payment");
    return res.status(500).json({ success: false, message: error.message, details: error.response });
  }
};

// POST /api/invoices/webhook/zoho
export const zohoWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    const event = payload.event_type || payload.event || payload.action;
    const data = payload.data || payload.payload || {};

    // Handle invoice creation from Zoho Books side
    if (event === "invoice_created" && data.invoice) {
      const zohoInvoiceId = data.invoice.invoice_id;
      const zohoInvoiceNumber = data.invoice.invoice_number;

      if (zohoInvoiceId) {
        // Check if we already have this invoice
        const existingInvoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });

        if (!existingInvoice) {
          // Create new invoice from Zoho data
          const newInvoice = await Invoice.create({
            invoice_number: zohoInvoiceNumber,
            zoho_invoice_id: zohoInvoiceId,
            zoho_invoice_number: zohoInvoiceNumber,
            source: "webhook",
            customer_id: data.invoice.customer_id,
            date: new Date(data.invoice.date),
            due_date: data.invoice.due_date ? new Date(data.invoice.due_date) : undefined,
            sub_total: data.invoice.sub_total || 0,
            discount: data.invoice.discount || 0,
            tax_total: data.invoice.tax_total || 0,
            total: data.invoice.total || 0,
            balance: data.invoice.balance || data.invoice.total || 0,
            amount_paid: data.invoice.amount_paid || 0,
            status: data.invoice.status === "paid" ? "paid" : "issued",
            currency_code: data.invoice.currency_code || "INR",
            exchange_rate: 1,
            gst_treatment: data.invoice.gst_treatment || "business_gst",
            place_of_supply: data.invoice.place_of_supply || "MH",
            payment_terms: data.invoice.payment_terms || 7,
            payment_terms_label: data.invoice.payment_terms_label || "Net 7",
            customer_id: data.invoice.customer_id,
            gst_no: data.invoice.gst_no,
            notes: data.invoice.notes || "",
            line_items: (data.invoice.line_items || []).map((item) => ({
              description: item.description || item.name,
              quantity: item.quantity || 1,
              unitPrice: item.rate || 0,
              amount: item.item_total || 0,
              name: item.name,
              rate: item.rate,
              unit: item.unit || "nos",
              item_total: item.item_total,
            })),
          });

          console.log(`✅ Created new invoice from Zoho webhook: ${zohoInvoiceNumber}`);
        }
      }
    }

    // Handle payment events
    if (event === "invoice_payment_made" || event === "payment_created") {
      const zohoInvoiceId = data.invoice_id || data.invoice?.invoice_id;
      const amount = Number(data.amount || data.paid_amount || 0);
      if (zohoInvoiceId) {
        const invoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        if (invoice) {
          invoice.amount_paid = Math.max(0, Number(invoice.amount_paid || 0) + amount);
          // Recompute balance including any locally tracked withheld tax
          invoice.balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0) - Number(invoice.tax_withheld_total || 0));
          if (invoice.balance === 0) {
            invoice.status = "paid";
            invoice.paid_at = new Date();
          }
          await invoice.save();
          // Update deposit mirror
          try { await applyPaymentToDeposit(invoice._id, amount); } catch (_) {}
        }
      }
    }

    // Handle status updates
    if (event === "invoice_status_changed" || event === "invoice_sent") {
      const zohoInvoiceId = data.invoice_id || data.invoice?.invoice_id;
      if (zohoInvoiceId) {
        const invoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        if (invoice) {
          invoice.zoho_status = data.status || data.invoice?.status || invoice.zoho_status;
          if (event === "invoice_sent") invoice.sent_at = new Date();
          await invoice.save();
        }
      }
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Zoho webhook error:", error);
    await logErrorActivity(req, error, "Zoho Webhook");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInvoices = async (req, res) => {
  try {
    const { client, contract, status, from, to } = req.query || {};
    const filter = {};
    if (client) filter.client = client;
    if (contract) filter.contract = contract;
    if (status) filter.status = status;
    if (from || to) {
      filter.issueDate = {};
      if (from) filter.issueDate.$gte = new Date(from);
      if (to) filter.issueDate.$lte = new Date(to);
    }

    const invoices = await Invoice.find(filter)
      .populate("client", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("building", "name city")
      .populate("cabin", "number floor")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: invoices });
  } catch (error) {
    await logErrorActivity(req, error, "Get Invoices");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/invoices/:id
export const getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id)
      .populate("client", "companyName contactPerson phone email")
      .populate("contract", "startDate endDate status")
      .populate("building", "name city")
      .populate("cabin", "number floor");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.json({ success: true, data: invoice });
  } catch (error) {
    await logErrorActivity(req, error, "Get Invoice by ID");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/invoices/:id/status
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amountPaid } = req.body || {};
    if (!status) return res.status(400).json({ success: false, message: "status is required" });

    const allowed = ["draft", "issued", "paid", "overdue", "void"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    if (typeof amountPaid === "number") {
      invoice.amount_paid = amountPaid;
      invoice.balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));
    }

    invoice.status = status;
    await invoice.save();

    // Log activity
    await logCRUDActivity(req, "UPDATE", "Invoice", invoice._id, null, {
      invoiceNumber: invoice.invoice_number,
      status,
    });

    return res.json({ success: true, data: invoice });
  } catch (error) {
    await logErrorActivity(req, error, "Update Invoice Status");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/invoices/:id
export const deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    // Prevent deleting invoices that have payments
    const paymentCount = await Payment.countDocuments({ invoice: id });
    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete invoice with existing payments. Please delete related payments first.",
      });
    }

    await Invoice.findByIdAndDelete(id);

    // Log activity
    await logCRUDActivity(req, "DELETE", "Invoice", id, null, {
      invoiceNumber: invoice.invoice_number,
    });

    return res.json({ success: true, message: "Invoice deleted successfully", deletedInvoiceId: id });
  } catch (error) {
    await logErrorActivity(req, error, "Delete Invoice");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/invoices/consolidation-preview
export const getConsolidationPreview = async (req, res) => {
  try {
    const { clientId, year, month } = req.query;

    if (!clientId || !year || !month) {
      return res.status(400).json({
        success: false,
        message: "clientId, year, and month are required",
      });
    }

    // Validate client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    // Find invoices for the specified month and year for this client
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const invoicesToConsolidate = await Invoice.find({
      client: clientId,
      date: { $gte: startDate, $lte: endDate },
      status: { $in: ["draft", "issued"] }, // Only consolidate unpaid invoices
    });

    // Calculate totals
    let totalAmount = 0;
    for (const invoice of invoicesToConsolidate) {
      totalAmount += invoice.total || 0;
    }

    return res.json({
      success: true,
      data: {
        invoiceCount: invoicesToConsolidate.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        period: {
          year: parseInt(year),
          month: parseInt(month),
          monthName: new Date(year, month - 1).toLocaleString("default", { month: "long" }),
        },
      },
    });
  } catch (error) {
    console.error("Error getting consolidation preview:", error);
    await logErrorActivity(req, error, "Get Consolidation Preview");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/invoices/consolidate
export const consolidateInvoices = async (req, res) => {
  try {
    const { year, month, clientId, sendEmail } = req.body;

    if (!year || !month || !clientId) {
      return res.status(400).json({
        success: false,
        message: "year, month, and clientId are required",
      });
    }

    // Validate client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    // Find invoices for the specified month and year for this client
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const invoicesToConsolidate = await Invoice.find({
      client: clientId,
      date: { $gte: startDate, $lte: endDate },
      status: { $in: ["draft", "issued"] }, // Only consolidate unpaid invoices
    }).populate("client contract building cabin");

    if (invoicesToConsolidate.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No eligible invoices found for consolidation in the specified period",
      });
    }

    if (invoicesToConsolidate.length === 1) {
      return res.status(400).json({
        success: false,
        message: "Only one invoice found - consolidation requires multiple invoices",
      });
    }

    // Calculate consolidated totals
    let consolidatedLineItems = [];
    let consolidatedSubTotal = 0;
    let consolidatedTaxTotal = 0;
    let consolidatedTotal = 0;
    let consolidatedAmountPaid = 0;
    const consolidatedInvoiceNumbers = [];

    for (const invoice of invoicesToConsolidate) {
      consolidatedInvoiceNumbers.push(invoice.invoice_number);

      // Add line items with invoice reference
      if (invoice.line_items && invoice.line_items.length > 0) {
        invoice.line_items.forEach((item) => {
          consolidatedLineItems.push({
            description: `${item.description} (Invoice: ${invoice.invoice_number})`,
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || item.rate || 0,
            amount: item.amount || item.item_total || 0,
            name: item.name,
            rate: item.rate,
            unit: item.unit || "nos",
            item_total: item.item_total,
          });
        });
      }

      consolidatedSubTotal += invoice.sub_total || 0;
      consolidatedTaxTotal += invoice.tax_total || 0;
      consolidatedTotal += invoice.total || 0;
      consolidatedAmountPaid += invoice.amount_paid || 0;
    }

    // Generate new invoice number for consolidated invoice
    const consolidatedInvoiceNumber = await generateLocalInvoiceNumber();

    // Create consolidated invoice
    const consolidatedInvoice = await Invoice.create({
      invoice_number: consolidatedInvoiceNumber,
      client: clientId,
      date: new Date(),
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      billing_period: {
        start: startDate,
        end: endDate,
      },

      line_items: consolidatedLineItems,
      sub_total: consolidatedSubTotal,
      tax_total: consolidatedTaxTotal,
      total: consolidatedTotal,
      amount_paid: consolidatedAmountPaid,
      balance: consolidatedTotal - consolidatedAmountPaid,
      status: consolidatedAmountPaid >= consolidatedTotal ? "paid" : "issued",
      notes: `Consolidated invoice for ${new Date(year, month - 1).toLocaleString(
        "default",
        { month: "long", year: "numeric" }
      )}. Original invoices: ${consolidatedInvoiceNumbers.join(", ")}`,
      currency_code: "INR",
      exchange_rate: 1,
      gst_treatment: client.gstTreatment || "business_gst",
      place_of_supply: "MH",
      payment_terms: 7,
      payment_terms_label: "Net 7",
      customer_id: client.zohoBooksContactId,
      gst_no: client.gstNo,
      meta: {
        consolidated: true,
        originalInvoices: consolidatedInvoiceNumbers,
        consolidationDate: new Date(),
      },
      ...(client.billingAddress && {
        billing_address: {
          attention: client.contactPerson,
          address: client.billingAddress.address,
          city: client.billingAddress.city,
          state: client.billingAddress.state,
          zip: client.billingAddress.zip,
          country: client.billingAddress.country || "IN",
          phone: client.phone,
        },
      }),
    });

    // Mark original invoices as consolidated
    await Invoice.updateMany(
      { _id: { $in: invoicesToConsolidate.map((inv) => inv._id) } },
      {
        status: "consolidated",
        consolidated_into: consolidatedInvoice._id,
        consolidated_at: new Date(),
      }
    );

    console.log(`Consolidated ${invoicesToConsolidate.length} invoices into ${consolidatedInvoiceNumber}`);

    try {
      if (client.zohoBooksContactId) {
        const zohoResponse = await createZohoInvoiceFromLocal(consolidatedInvoice.toObject(), client.toObject());
        const invoiceData = zohoResponse.invoice || zohoResponse;

        if (invoiceData && invoiceData.invoice_id) {
          consolidatedInvoice.zoho_invoice_id = invoiceData.invoice_id;
          consolidatedInvoice.zoho_invoice_number = invoiceData.invoice_number;
          consolidatedInvoice.zoho_status = invoiceData.status || invoiceData.status_formatted;
          consolidatedInvoice.zoho_pdf_url = invoiceData.pdf_url;
          consolidatedInvoice.invoice_url = invoiceData.invoice_url;
          await consolidatedInvoice.save();

          console.log(`Pushed consolidated invoice ${consolidatedInvoice._id} to Zoho Books: ${invoiceData.invoice_id}`);

          // Send email if requested and we have Zoho invoice
          if (sendEmail && client.email) {
            try {
              await sendZohoInvoiceEmail(invoiceData.invoice_id, {
                to_mail_ids: [client.email],
                subject: `Consolidated Invoice ${consolidatedInvoiceNumber}`,
                body: 'Please find attached your consolidated invoice.'
              });

              consolidatedInvoice.sent_at = new Date();
              await consolidatedInvoice.save();
              console.log(`Sent consolidated invoice email to ${client.email}`);
            } catch (emailError) {
              console.error(`Failed to send consolidated invoice email:`, emailError.message);
            }
          }
        }
      }
    } catch (zohoError) {
      console.error(`Failed to push consolidated invoice to Zoho Books:`, zohoError.message);
    }

    return res.status(201).json({
      success: true,
      data: consolidatedInvoice,
      message: `Successfully consolidated ${invoicesToConsolidate.length} invoices`,
      originalInvoices: consolidatedInvoiceNumbers,
      emailSent: sendEmail && client.email ? true : false,
    });
  } catch (error) {
    console.error("Error consolidating invoices:", error);
    await logErrorActivity(req, error, "Consolidate Invoices");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/invoices/:id/payments - Get all payments for an invoice
export const getInvoicePayments = async (req, res) => {
  try {
    const { id } = req.params;
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const payments = await Payment.find({ invoice: id })
      .populate("client", "companyName contactPerson")
      .sort({ paymentDate: -1 });

    return res.json({ success: true, data: payments });
  } catch (error) {
    await logErrorActivity(req, error, "Get Invoice Payments");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/invoices/:id/send-email - Send invoice via email
export const sendInvoiceViaEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    
    // Role-based restriction: Only Finance Senior can send invoices
    const userRole = req.userRole?.roleName || "";
    if (userRole === "finance_junior") {
      return res.status(403).json({ 
        success: false, 
        message: "Only Finance Senior users can send invoices. Please contact your Finance Senior." 
      });
    }
    
    const invoice = await Invoice.findById(id).populate("client");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const recipientEmail = email || invoice.client?.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: "No email address provided" });
    }

    // If invoice is in Zoho, send via Zoho
    if (invoice.zoho_invoice_id) {
      await sendZohoInvoiceEmail(invoice.zoho_invoice_id, {
        to_mail_ids: [recipientEmail],
        subject: `Invoice ${invoice.invoice_number || invoice.zoho_invoice_number}`,
        body: 'Please find attached your invoice.'
      });
    }

    // Update invoice status
    invoice.status = 'sent';
    invoice.sent_at = new Date();
    await invoice.save();

    await logCRUDActivity(req, "UPDATE", "Invoice", invoice._id, null, {
      action: "sent_email",
      email: recipientEmail,
    });

    return res.json({ success: true, data: invoice, message: "Invoice sent successfully" });
  } catch (error) {
    await logErrorActivity(req, error, "Send Invoice Email");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/invoices/:id/mark-paid - Mark invoice as paid
export const markInvoiceAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentDate, paymentMode, referenceNumber, amount, tax_deducted, tax_amount_withheld } = req.body;
    const withheld = Boolean(tax_deducted) ? Number(tax_amount_withheld || 0) : 0;
    if (withheld < 0) return res.status(400).json({ success: false, message: "tax_amount_withheld must be >= 0" });

    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const paymentAmount = amount || invoice.balance || invoice.total;

    // Create payment record
    const payment = await Payment.create({
      invoice: id,
      client: invoice.client,
      amount: paymentAmount,
      type: paymentMode || "Bank Transfer",
      referenceNumber: referenceNumber || `PAY-${Date.now()}`,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      notes: "Payment recorded from invoice details",
      source: "manual",
      invoices: [{ invoice: id, amount_applied: Number(paymentAmount), tax_deducted: Boolean(tax_deducted), tax_amount_withheld: withheld }],
      tax_deducted: Boolean(tax_deducted),
      tax_amount_withheld: withheld,
      tax_amount_withheld_total: withheld,
    });

    // Update invoice
    invoice.amount_paid = Math.max(0, Number(invoice.amount_paid || 0) + Number(paymentAmount));
    invoice.tax_withheld_total = Math.max(0, Number(invoice.tax_withheld_total || 0) + Number(withheld));
    invoice.balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0) - Number(invoice.tax_withheld_total || 0));
    
    if (invoice.balance === 0) {
      invoice.status = "paid";
      invoice.paid_at = new Date();
    } else if (invoice.amount_paid > 0) {
      invoice.status = "partially_paid";
    }

    await invoice.save();

    await logPaymentActivity(req, "PAYMENT_MADE", "Invoice", invoice._id, {
      paymentId: payment._id,
      amount: paymentAmount,
      tax_deducted: Boolean(tax_deducted),
      tax_amount_withheld: withheld,
      paymentMode,
      referenceNumber,
    });

    return res.json({ success: true, data: invoice, payment, message: "Payment recorded successfully" });
  } catch (error) {
    await logErrorActivity(req, error, "Mark Invoice as Paid");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/invoices/:id/mark-sent
export const markInvoiceAsSent = async (req, res) => {
  try {
    const { id } = req.params;

    // Permission is handled at route level (INVOICE_SEND)
    const invoice = await Invoice.findById(id).populate("client");
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Ensure invoice is synced to Zoho first
    let client = invoice.client || (invoice.client && (await Client.findById(invoice.client)));
    if (!invoice.zoho_invoice_id) {
      if (!client) return res.status(400).json({ success: false, message: "Invoice has no linked client" });

      // Ensure Zoho contact exists
      if (!client.zohoBooksContactId) {
        const contactId = await findOrCreateContactFromClient(client);
        if (!contactId) {
          return res.status(400).json({ success: false, message: "Failed to find or create Zoho contact for client" });
        }
        client.zohoBooksContactId = contactId;
        await client.save();
      }

      // Push local invoice to Zoho as draft
      try {
        const zohoResp = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject());
        const zohoId = zohoResp?.invoice?.invoice_id;
        if (!zohoId) {
          return res.status(400).json({ success: false, message: "Zoho did not return an invoice_id", details: zohoResp });
        }
        invoice.zoho_invoice_id = zohoId;
        invoice.zoho_invoice_number = zohoResp?.invoice?.invoice_number || invoice.zoho_invoice_number;
        invoice.zoho_status = zohoResp?.invoice?.status || invoice.zoho_status || "draft";
        await invoice.save();
      } catch (e) {
        return res.status(400).json({ success: false, message: `Failed to push invoice to Zoho: ${e.message}` });
      }
    }

    // Mark the Zoho invoice as sent without emailing
    try {
      await markZohoInvoiceAsSent(invoice.zoho_invoice_id);
      invoice.status = "sent";
      invoice.zoho_status = "sent";
      invoice.sent_at = new Date();
      await invoice.save();
      return res.json({ success: true, data: invoice });
    } catch (e) {
      return res.status(400).json({ success: false, message: `Failed to mark as sent in Zoho: ${e.message}` });
    }
  } catch (error) {
    await logErrorActivity(req, error, "Mark Invoice As Sent");
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/invoices/:id/push-zoho-guest
// Push an invoice to Zoho Books using a Guest (ondemand) instead of a Client. Always pushes as draft (no email).
export const pushInvoiceToZohoGuest = async (req, res) => {
  try {
    const { id } = req.params;
    const { guestId } = req.body || {};

    if (!guestId) {
      return res.status(400).json({ success: false, message: "guestId is required" });
    }

    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // If already linked to Zoho, return as success
    if (invoice.zoho_invoice_id) {
      return res.json({ success: true, data: invoice, zoho_invoice_id: invoice.zoho_invoice_id });
    }

    const guest = await Guest.findById(guestId);
    if (!guest) {
      return res.status(404).json({ success: false, message: "Guest not found" });
    }

    // Ensure Zoho contact for guest
    if (!guest.zohoBooksContactId) {
      const payload = {
        contact_name: guest.name || guest.companyName || `Guest ${guest._id}`,
        company_name: guest.companyName || undefined,
        email: guest.email || undefined,
        phone: guest.phone || undefined,
        mobile: guest.phone || undefined,
        contact_type: 'customer',
        customer_sub_type: 'individual',
        notes: `Ondemand guest created via guest invoice push for invoice ${invoice.invoice_number || invoice._id}`,
        contact_persons: [
          {
            first_name: (guest.name || '').split(' ')[0] || 'Guest',
            last_name: (guest.name || '').split(' ').slice(1).join(' ') || '',
            email: guest.email || '',
            phone: guest.phone || '',
            mobile: guest.phone || '',
            is_primary_contact: true,
          },
        ],
      };
      try {
        const z = await createZohoContact(payload);
        const cid = z?.contact?.contact_id || z?.data?.contact?.contact_id || z?.contact_id || null;
        if (!cid) {
          return res.status(400).json({ success: false, message: "Failed to create Zoho contact for guest" });
        }
        guest.zohoBooksContactId = cid;
        await guest.save();
      } catch (e) {
        await logErrorActivity(req, e, "Create Zoho Contact for Guest");
        return res.status(400).json({ success: false, message: e.message || "Failed to create Zoho contact for guest" });
      }
    }

    // Push to Zoho using guest contact, keep as draft
    try {
      const zohoResp = await createZohoInvoiceFromLocal(
        invoice.toObject(),
        { _id: null, zohoBooksContactId: guest.zohoBooksContactId }
      );
      const zohoId = zohoResp?.invoice?.invoice_id;
      const zohoNumber = zohoResp?.invoice?.invoice_number;
      if (!zohoId) {
        return res.status(400).json({ success: false, message: "Zoho did not return an invoice_id", details: zohoResp });
      }

      invoice.zoho_invoice_id = zohoId;
      invoice.zoho_invoice_number = zohoNumber || invoice.zoho_invoice_number;
      invoice.source = invoice.source || "zoho";
      invoice.status = 'draft';
      invoice.zoho_status = 'draft';
      await invoice.save();

      // After pushing invoice to Zoho, also push any associated payments (non-blocking on errors)
      try {
        const payments = await Payment.find({ invoice: id });
        if (payments && payments.length > 0) {
          for (const payment of payments) {
            if (payment.zoho_payment_id) continue; // already synced

            // Get latest Zoho invoice details to calculate applicable amount
            const zohoInvoiceDetails = await getZohoInvoice(zohoId);
            const zohoBalance = Number(zohoInvoiceDetails?.balance || zohoInvoiceDetails?.total || 0);
            const paymentAmount = Number(payment.amount || 0);
            const amountToApply = Math.min(paymentAmount, zohoBalance);
            if (amountToApply <= 0) continue;

            const zohoPaymentPayload = {
              customer_id: guest.zohoBooksContactId,
              payment_mode: payment.type || 'cash',
              amount: amountToApply,
              date: payment.paymentDate ? new Date(payment.paymentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              invoices: [{
                invoice_id: invoice.zoho_invoice_id,
                amount_applied: amountToApply,
              }],
              reference_number: payment.referenceNumber || payment.paymentGatewayRef || '',
              description: payment.notes || `Payment for invoice ${invoice.invoice_number}`,
            };

            const accessToken = await getValidAccessToken();
            const orgId = process.env.ZOHO_ORG_ID;
            if (orgId && accessToken) {
              const zohoUrl = `https://www.zohoapis.in/books/v3/customerpayments?organization_id=${orgId}`;
              const zohoPaymentResponse = await fetch(zohoUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(zohoPaymentPayload),
              });
              const zohoPaymentData = await zohoPaymentResponse.json();
              if (zohoPaymentResponse.ok && zohoPaymentData?.payment?.payment_id) {
                payment.zoho_payment_id = zohoPaymentData.payment.payment_id;
                payment.payment_number = zohoPaymentData.payment.payment_number;
                payment.zoho_status = zohoPaymentData.payment.status;
                payment.source = 'zoho_books';
                await payment.save();
              } else {
                console.warn('Failed to push guest payment to Zoho:', zohoPaymentData?.message || 'Unknown error');
              }
            }
          }
        }
      } catch (paymentErr) {
        console.warn('Failed to push payments to Zoho (guest flow):', paymentErr?.message || paymentErr);
      }

      return res.json({ 
        success: true, 
        data: invoice, 
        zoho_invoice_id: invoice.zoho_invoice_id,
        zoho_invoice_number: invoice.zoho_invoice_number,
        sent: false,
        zohoContactId: guest.zohoBooksContactId
      });
    } catch (err) {
      await logErrorActivity(req, err, "Push Invoice to Zoho (Guest)");
      return res.status(400).json({ success: false, message: err.message });
    }
  } catch (error) {
    await logErrorActivity(req, error, "Push Invoice to Zoho (Guest)");
    return res.status(500).json({ success: false, message: error.message });
  }
};