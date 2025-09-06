import fetch from "node-fetch";

const BASE_URL = process.env.ZOHO_BOOKS_BASE_URL?.replace(/\/v2$/, "/v3") || "https://books.zohoapis.com/api/v3";
const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID || process.env.ZOHO_ORG_ID;
const BOOK_TOKEN = process.env.ZOHO_BOOK_TOKEN || process.env.ZOHO_ACCESS_TOKEN;

function ensureEnv() {
  if (!BOOK_TOKEN) throw new Error("ZOHO_BOOK_TOKEN is not configured");
  if (!ORG_ID) throw new Error("ZOHO_BOOKS_ORG_ID (or ZOHO_ORG_ID) is not configured");
}

export async function zohoBooksFetch(path, { method = "GET", body, headers = {} } = {}) {
  ensureEnv();
  const url = path.startsWith("http") ? path : `${BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const finalHeaders = {
    Authorization: `Zoho-oauthtoken ${BOOK_TOKEN}`,
    "X-com-zoho-books-organizationid": ORG_ID,
    "Content-Type": "application/json",
    ...headers,
  };
  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok || (json && json.code && json.code !== 0)) {
    const err = new Error(json?.message || json?.error || `Zoho request failed: ${res.status}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

export async function findOrCreateContactFromClient(clientDoc) {
  ensureEnv();
  const email = clientDoc?.email;
  const companyName = clientDoc?.companyName || clientDoc?.contactPerson || "Unknown";

  // Try lookup by email
  if (email) {
    try {
      const search = await zohoBooksFetch(`contacts?email=${encodeURIComponent(email)}`);
      const existing = search?.contacts?.[0];
      if (existing) return existing.contact_id;
    } catch (_) { /* ignore and try create */ }
  }

  // Create minimal contact
  const payload = {
    contact_name: companyName,
    company_name: companyName,
    email: email || undefined,
    billing_address: {
      attention: clientDoc?.contactPerson || undefined,
    },
  };
  const created = await zohoBooksFetch("contacts", { method: "POST", body: payload });
  return created?.contact?.contact_id;
}

export function mapLineItemsFromLocal(localInvoice) {
  const items = Array.isArray(localInvoice?.items) ? localInvoice.items : [];
  return items.map((it) => ({
    item_name: it.description || "Item",
    rate: Number(it.unitPrice || 0),
    quantity: Number(it.quantity || 0),
  }));
}

export async function createZohoInvoiceFromLocal(localInvoice, clientDoc) {
  const customer_id = await findOrCreateContactFromClient(clientDoc);
  const payload = {
    customer_id,
    date: localInvoice.issueDate ? new Date(localInvoice.issueDate).toISOString().slice(0,10) : undefined,
    due_date: localInvoice.dueDate ? new Date(localInvoice.dueDate).toISOString().slice(0,10) : undefined,
    reference_number: localInvoice.invoiceNumber,
    line_items: mapLineItemsFromLocal(localInvoice),
    notes: localInvoice.notes || undefined,
  };

  // Discount mapping
  if (localInvoice?.discount) {
    const { type, value } = localInvoice.discount;
    if (type === "percent") payload.discount = Number(value || 0);
    else if (type === "flat") payload.discount_amount = Number(value || 0);
  }

  const resp = await zohoBooksFetch("invoices", { method: "POST", body: payload });
  return resp?.invoice;
}

export async function sendZohoInvoiceEmail(zohoInvoiceId, { to, subject, body } = {}) {
  const payload = {
    to_mail_ids: Array.isArray(to) ? to : (to ? [to] : undefined),
    subject: subject || undefined,
    body: body || undefined,
  };
  const resp = await zohoBooksFetch(`invoices/${zohoInvoiceId}/email`, { method: "POST", body: payload });
  return resp;
}

export async function getZohoInvoice(zohoInvoiceId) {
  const resp = await zohoBooksFetch(`invoices/${zohoInvoiceId}`);
  return resp?.invoice;
}

export async function getZohoInvoicePdfUrl(zohoInvoiceId) {
  const inv = await getZohoInvoice(zohoInvoiceId);
  return inv?.pdf_url || inv?.invoice_url;
}

export async function recordZohoPayment(zohoInvoiceId, { amount, date, payment_mode, reference_number } ) {
  const payload = {
    customer_id: undefined, // Zoho infers from invoice
    payment_mode,
    amount: Number(amount),
    date: date ? new Date(date).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    reference_number: reference_number || undefined,
    invoices: [{ invoice_id: zohoInvoiceId, amount_applied: Number(amount) }],
  };
  const resp = await zohoBooksFetch("customerpayments", { method: "POST", body: payload });
  return resp?.payment;
}
