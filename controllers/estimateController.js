import Estimate from "../models/estimateModel.js";
import Client from "../models/clientModel.js";
import Contract from "../models/contractModel.js";
import Invoice from "../models/invoiceModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { findOrCreateContactFromClient, createZohoEstimateFromLocal, getZohoEstimate, markZohoEstimateAsSent, createZohoInvoiceFromLocal, sendZohoInvoiceEmail } from "../utils/zohoBooks.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";

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

  return { items, subtotal, discount: { type: discount.type || "flat", value: Number(discount.value || 0), amount: discountAmount }, taxes, total };
}

export const createProforma = async (req, res) => {
  try {
    const body = req.body || {};
    const { client, contract, billingPeriod, issueDate, expiryDate, notes, referenceNumber, status } = body;

    if (!client) return res.status(400).json({ success: false, message: "client is required" });

    const [clientDoc, contractDoc] = await Promise.all([
      Client.findById(client),
      contract ? Contract.findById(contract) : Promise.resolve(null),
    ]);
    if (!clientDoc) return res.status(404).json({ success: false, message: "Client not found" });
    if (contract && !contractDoc) return res.status(404).json({ success: false, message: "Contract not found" });

    const totals = computeTotals(body);

    const estimateData = {
      client,
      contract: contract || undefined,
      building: contractDoc?.building || clientDoc?.building || body.building,
      date: issueDate ? new Date(issueDate) : new Date(),
      expiry_date: expiryDate ? new Date(expiryDate) : undefined,
      ...(billingPeriod?.start && billingPeriod?.end ? { billing_period: { start: new Date(billingPeriod.start), end: new Date(billingPeriod.end) } } : {}),
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
      tax_total: totals.taxes.reduce((s, t) => s + t.amount, 0),
      total: totals.total,
      notes: notes || "Pro Forma (Estimate) created",
      currency_code: "INR",
      exchange_rate: 1,
      // GST/tax mapping from client defaults
      gst_treatment: body.gst_treatment || body.gstTreatment || clientDoc.gstTreatment || "business_gst",
      place_of_supply: body.place_of_supply || body.placeOfSupply || clientDoc?.billingAddress?.state_code || clientDoc?.billingAddress?.state || undefined,
      customer_id: clientDoc.zohoBooksContactId,
      gst_no: body.gst_no || body.gstNo || clientDoc.gstNo || clientDoc.gstNumber,
      reference_number: referenceNumber,
      status: status || "draft",
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
    };

    const estimate = await Estimate.create(estimateData);

    await logCRUDActivity(req, "CREATE", "Estimate", estimate._id, null, {
      clientId: estimate.client,
      totalAmount: estimate.total,
    });

    return res.status(201).json({ success: true, data: estimate });
  } catch (error) {
    await logErrorActivity(req, error, "Estimate Creation");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getProformas = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search, client, contract } = req.query;
    const q = {};
    if (status) q.status = status;
    if (client) q.client = client;
    if (contract) q.contract = contract;
    if (search) {
      q.$or = [
        { estimate_number: { $regex: search, $options: "i" } },
        { reference_number: { $regex: search, $options: "i" } },
      ];
    }
    const docs = await Estimate.find(q)
      .populate("client", "companyName contactPerson email phone")
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));
    const total = await Estimate.countDocuments(q);
    return res.json({ success: true, data: docs, pagination: { page: Number(page), limit: Number(limit), total } });
  } catch (error) {
    await logErrorActivity(req, error, "Get Proformas");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getProformaById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Estimate.findById(id).populate("client");
    if (!doc) return res.status(404).json({ success: false, message: "Estimate not found" });
    return res.json({ success: true, data: doc });
  } catch (error) {
    await logErrorActivity(req, error, "Get Proforma By Id");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const pushProformaToZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendStatus } = req.body; // 'draft' or 'sent' equivalent for estimates is mark_sent
    const estimate = await Estimate.findById(id).populate("client");
    if (!estimate) return res.status(404).json({ success: false, message: "Estimate not found" });

    // If already linked
    if (estimate.zoho_estimate_id) {
      if (sendStatus === "sent") {
        try {
          await markZohoEstimateAsSent(estimate.zoho_estimate_id);
          estimate.status = "sent";
          estimate.zoho_status = "sent";
          await estimate.save();
          return res.json({ success: true, data: estimate, message: "Estimate marked as sent in Zoho" });
        } catch (e) {
          return res.status(400).json({ success: false, message: e.message });
        }
      }
      return res.json({ success: true, data: estimate, message: "Estimate already linked to Zoho" });
    }

    // Ensure client Zoho contact exists
    let client = estimate.client ? estimate.client : await Client.findById(estimate.client);
    if (!client) return res.status(400).json({ success: false, message: "Estimate has no linked client or client not found" });

    try {
      if (!client.zohoBooksContactId) {
        const contactId = await findOrCreateContactFromClient(client);
        if (!contactId) return res.status(400).json({ success: false, message: "Failed to find or create Zoho contact for client" });
        client.zohoBooksContactId = contactId;
        await client.save();
      }

      const zohoResp = await createZohoEstimateFromLocal(estimate.toObject(), client.toObject());
      const zId = zohoResp?.estimate?.estimate_id || zohoResp?.estimate?.estimate_id || zohoResp?.estimate_id;
      const zNumber = zohoResp?.estimate?.estimate_number || zohoResp?.estimate_number;
      if (!zId) return res.status(400).json({ success: false, message: "Zoho did not return an estimate_id", details: zohoResp });

      estimate.zoho_estimate_id = zId;
      estimate.zoho_estimate_number = zNumber || estimate.zoho_estimate_number;
      estimate.source = estimate.source || "zoho";
      await estimate.save();

      if (sendStatus === "sent") {
        try {
          await markZohoEstimateAsSent(zId);
          estimate.status = "sent";
          estimate.zoho_status = "sent";
          await estimate.save();
        } catch (e) {
          // keep linked but not sent
        }
      }

      return res.json({ success: true, data: estimate, zoho: zohoResp, sent: estimate.status === "sent" });
    } catch (err) {
      await logErrorActivity(req, err, "Push Proforma to Zoho");
      return res.status(400).json({ success: false, message: err.message });
    }
  } catch (error) {
    await logErrorActivity(req, error, "Push Proforma to Zoho");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const syncProformaFromZoho = async (req, res) => {
  try {
    const { id } = req.params;
    const est = await Estimate.findById(id);
    if (!est) return res.status(404).json({ success: false, message: "Estimate not found" });
    if (!est.zoho_estimate_id) return res.status(400).json({ success: false, message: "Estimate not synced to Zoho yet" });

    const z = await getZohoEstimate(est.zoho_estimate_id);
    if (z) {
      est.zoho_status = z.status || z.status_formatted || est.zoho_status;
      est.zoho_pdf_url = z.pdf_url || est.zoho_pdf_url;
      est.estimate_url = z.estimate_url || est.estimate_url;
      await est.save();
    }
    return res.json({ success: true, data: est, zoho: z });
  } catch (error) {
    await logErrorActivity(req, error, "Sync Proforma from Zoho");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const convertProformaToInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { sendStatus = 'sent' } = req.body || {};

    const estimate = await Estimate.findById(id).populate('client');
    if (!estimate) return res.status(404).json({ success: false, message: 'Estimate not found' });

    // Resolve client
    let client = estimate.client || (await Client.findById(estimate.client));
    if (!client) return res.status(400).json({ success: false, message: 'Estimate has no linked client' });

    // Ensure client is linked to Zoho
    try {
      if (!client.zohoBooksContactId) {
        const contactId = await findOrCreateContactFromClient(client);
        if (!contactId) return res.status(400).json({ success: false, message: 'Failed to find or create Zoho contact for client' });
        client.zohoBooksContactId = contactId;
        await client.save();
      }
    } catch (e) {
      await logErrorActivity(req, e, 'Estimate Convert: ensure Zoho contact');
      return res.status(400).json({ success: false, message: e.message || 'Failed to link client in Zoho' });
    }

    // Prepare Invoice payload from Estimate
    const localInvoiceNumber = await generateLocalInvoiceNumber();
    const issueDate = estimate.date ? new Date(estimate.date) : new Date();
    const dueDate = estimate.expiry_date ? new Date(estimate.expiry_date) : new Date(issueDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const invoiceData = {
      invoice_number: localInvoiceNumber,
      client: client._id,
      contract: estimate.contract || undefined,
      building: estimate.building || client.building || undefined,
      date: issueDate,
      due_date: dueDate,
      billing_period: estimate.billing_period && estimate.billing_period.start && estimate.billing_period.end
        ? { start: new Date(estimate.billing_period.start), end: new Date(estimate.billing_period.end) }
        : undefined,
      line_items: (estimate.line_items || []).map((li) => ({
        description: li.description,
        quantity: Number(li.quantity || 1),
        unitPrice: Number(li.unitPrice || li.rate || 0),
        amount: Number(li.amount || 0),
        name: li.name || li.description,
        rate: Number(li.rate || li.unitPrice || 0),
        unit: li.unit || 'nos',
        item_total: Number(li.item_total || li.amount || 0),
        // Preserve tax percentage from estimate to drive IGST selection downstream
        ...(typeof li.tax_percentage === 'number' ? { tax_percentage: Number(li.tax_percentage) } : {}),
      })),
      sub_total: Number(estimate.sub_total || 0),
      tax_total: Number(estimate.tax_total || 0),
      total: Number(estimate.total || 0),
      amount_paid: 0,
      balance: Number(estimate.total || 0),
      status: 'draft',
      notes: (estimate.notes || 'Converted from Pro Forma'),
      currency_code: estimate.currency_code || 'INR',
      exchange_rate: estimate.exchange_rate || 1,
      gst_treatment: estimate.gst_treatment || client.gstTreatment || 'business_gst',
      place_of_supply: estimate.place_of_supply || client?.billingAddress?.state_code || client?.billingAddress?.state,
      // Pass org state code explicitly so IGST can be chosen for interstate
      organization_state_code: process.env.ZOHO_ORG_STATE_CODE || process.env.ZOHO_BOOKS_ORG_STATE_CODE || undefined,
      customer_id: client.zohoBooksContactId,
      gst_no: estimate.gst_no || client.gstNo || client.gstNumber,
    };

    const invoice = await Invoice.create(invoiceData);

    await logCRUDActivity(req, 'CREATE', 'Invoice', invoice._id, null, {
      fromEstimateId: estimate._id,
      invoiceNumber: invoice.invoice_number,
      clientId: invoice.client,
      totalAmount: invoice.total,
    });

    // Push to Zoho and optionally send
    try {
      const zohoResp = await createZohoInvoiceFromLocal(invoice.toObject(), client.toObject());
      const zohoId = zohoResp?.invoice?.invoice_id;
      const zohoNumber = zohoResp?.invoice?.invoice_number;
      if (!zohoId) {
        return res.status(400).json({ success: false, message: 'Zoho did not return an invoice_id', details: zohoResp });
      }

      invoice.zoho_invoice_id = zohoId;
      invoice.zoho_invoice_number = zohoNumber || invoice.zoho_invoice_number;
      invoice.source = invoice.source || 'zoho';

      // Send immediately if requested and email available
      if (sendStatus === 'sent') {
        if (!client.email) {
          await invoice.save();
          await logCRUDActivity(req, 'UPDATE', 'Invoice', invoice._id, null, { warning: 'Client email missing, left as draft in Zoho' });
          // Still update estimate status to accepted
          estimate.status = 'accepted';
          await estimate.save();
          return res.status(400).json({ success: false, message: 'Client has no email, invoice pushed as draft in Zoho', data: invoice });
        }
        try {
          await sendZohoInvoiceEmail(zohoId, {
            to_mail_ids: [client.email],
            subject: `Invoice ${invoice.invoice_number || zohoNumber}`,
            body: 'Please find attached your invoice.'
          });
          invoice.status = 'sent';
          invoice.zoho_status = 'sent';
          invoice.sent_at = new Date();
        } catch (emailErr) {
          // keep as draft if email failed
          await logErrorActivity(req, emailErr, 'Send Invoice Email (from estimate convert)');
          invoice.status = 'draft';
          invoice.zoho_status = 'draft';
        }
      } else {
        invoice.status = 'draft';
        invoice.zoho_status = 'draft';
      }

      await invoice.save();
    } catch (pushErr) {
      await logErrorActivity(req, pushErr, 'Push Converted Invoice to Zoho');
      // Keep local invoice; return error
      return res.status(400).json({ success: false, message: pushErr.message || 'Failed to push invoice to Zoho', data: invoice });
    }

    // Mark estimate as accepted after conversion
    try {
      estimate.status = 'accepted';
      await estimate.save();
      await logCRUDActivity(req, 'UPDATE', 'Estimate', estimate._id, null, { status: 'accepted', convertedToInvoice: invoice._id });
    } catch (_) { }

    return res.json({ success: true, data: { invoice, estimateId: estimate._id } });
  } catch (error) {
    await logErrorActivity(req, error, 'Convert Proforma To Invoice');
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveProforma = async (req, res) => {
  try {
    const { id } = req.params;
    const estimate = await Estimate.findById(id);

    if (!estimate) {
      return res.status(404).json({ success: false, message: "Estimate not found" });
    }

    if (estimate.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `Only draft estimates can be approved. Current status: ${estimate.status}`
      });
    }

    estimate.status = 'approved_internal';
    await estimate.save();

    await logCRUDActivity(req, "UPDATE", "Estimate", estimate._id, null, {
      previousStatus: "draft",
      newStatus: "approved_internal",
      action: "manual_approval"
    });

    return res.json({
      success: true,
      data: estimate,
      message: "Pro Forma estimate approved internally. It will be sent to the client on the scheduled date."
    });
  } catch (error) {
    await logErrorActivity(req, error, "Approve Proforma");
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectProforma = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const estimate = await Estimate.findById(id);

    if (!estimate) {
      return res.status(404).json({ success: false, message: "Estimate not found" });
    }

    if (estimate.status !== 'draft' && estimate.status !== 'approved_internal') {
      return res.status(400).json({
        success: false,
        message: `Only draft or locally approved estimates can be rejected. Current status: ${estimate.status}`
      });
    }

    estimate.status = 'declined';
    estimate.rejection_note = notes || "";
    await estimate.save();

    await logCRUDActivity(req, "UPDATE", "Estimate", estimate._id, null, {
      previousStatus: estimate.status,
      newStatus: "declined",
      rejectionNote: notes,
      action: "manual_rejection"
    });

    return res.json({
      success: true,
      data: estimate,
      message: "Pro Forma estimate rejected."
    });
  } catch (error) {
    await logErrorActivity(req, error, "Reject Proforma");
    return res.status(500).json({ success: false, message: error.message });
  }
};
