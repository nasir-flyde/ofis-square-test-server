import fetch from "node-fetch";
import { getValidAccessToken } from "./zohoTokenManager.js";

const ORG_ID = "60047183737";
// Use zohoapis.com domain as per Zoho's updated requirements
const BASE_URL = "https://www.zohoapis.in/books/v3";

export async function getContacts() {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/contacts?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error fetching contacts:", err.message);
    throw err;
  }
}

export async function createContact(payload) {
  const authToken = await getValidAccessToken();
  const url = `${BASE_URL}/contacts?organization_id=${ORG_ID}`;
  const maskedToken = authToken ? `${String(authToken).slice(0, 8)}…` : undefined;
  const startTime = Date.now();

  // Pre-request diagnostics
  console.log("\n===== ZohoBooks:createContact - Request =====");
  console.log("URL:", url);
  console.log("Headers:", { Authorization: `Zoho-oauthtoken ${maskedToken}`, "Content-Type": "application/json" });
  console.log("Payload keys:", Object.keys(payload || {}));
  const sanitizeContactPayload = (p) => {
    const allowedKeys = new Set([
      "contact_name",
      "company_name",
      "email",
      "phone",
      "mobile",
      "contact_type",
      "is_customer",
      "is_supplier",
      "customer_sub_type",
      "billing_address",
      "shipping_address",
      "website",
      "currency_code",
      "notes",
      "custom_fields",
      "legal_name",
      "payment_terms",
      "payment_terms_label",
      "pan_no",
      "gst_no",
      "gst_treatment",
      "tax_reg_no",
      "contact_persons",
      "first_name",
      "last_name",
      "designation",
      "department",
      "contact_salutation",
      "twitter",
      "facebook",
      "credit_limit",
      "portal_status",
      "is_portal_enabled",
      "currency_id",
      "price_precision",
      "opening_balance_amount",
      "tds_tax_id",
      "trader_name",
      "udyam_reg_no",
      "msme_type",
      "sales_channel"
    ]);
    const sanitized = {};
    const removed = [];
    for (const [k, v] of Object.entries(p || {})) {
      if (allowedKeys.has(k)) {
        sanitized[k] = v;
      } else {
        removed.push(k);
      }
    }
    // Remove unsupported top-level flags if present
    delete sanitized.is_sms_enabled;

    // Deep sanitize contact_persons if provided
    if (Array.isArray(sanitized.contact_persons)) {
      const cpAllowed = new Set([
        "salutation",
        "first_name",
        "last_name",
        "email",
        "phone",
        "mobile",
        "designation",
        "department",
        "is_primary_contact",
        "enable_portal"
      ]);
      sanitized.contact_persons = sanitized.contact_persons.map((cp) => {
        const out = {};
        if (cp && typeof cp === "object") {
          for (const [ck, cv] of Object.entries(cp)) {
            if (cpAllowed.has(ck)) {
              out[ck] = cv;
            } else {
              // Track nested removals for debugging
              removed.push(`contact_persons.${ck}`);
            }
          }
        }
        // Explicitly strip nested flags if somehow present
        delete out.is_sms_enabled;
        delete out.communication_preference;
        return out;
      });
    }
    if (removed.length) {
      console.log("ZohoBooks:createContact - stripped unsupported keys:", removed);
    }
    return sanitized;
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitizeContactPayload(payload)),
    });

    const durationMs = Date.now() - startTime;
    const rawText = await res.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      data = { parse_error: String(e?.message || e), raw: rawText };
    }

    // Post-response diagnostics
    console.log("===== ZohoBooks:createContact - Response =====");
    console.log("HTTP:", res.status, res.statusText || "");
    console.log("Duration(ms):", durationMs);
    console.log("Body:", typeof data === "object" ? JSON.stringify(data, null, 2) : data);

    if (!res.ok) {
      const errMsg = data?.message || data?.code || `Zoho API error (status ${res.status})`;
      console.error("❌ ZohoBooks:createContact failed:", errMsg);
      throw new Error(errMsg);
    }

    return data;
  } catch (err) {
    console.error("❌ [ZohoBooks] Error creating contact:", err?.message || err);
    throw err;
  }
}


// -------------------
// Find or create a contact from local client data
// -------------------
export async function findOrCreateContactFromClient(clientDoc) {
  const email = clientDoc?.email;
  const companyName = clientDoc?.companyName || clientDoc?.contactPerson || "Unknown";
  const phone = clientDoc?.phone || undefined;
  const contactPerson = clientDoc?.contactPerson || undefined;

  // Try lookup by email
  if (email) {
    const contacts = await getContacts();
    const existing = contacts?.contacts?.find(c => c.email === email);
    if (existing) return existing.contact_id;
  }

  // Map client data to Zoho Books format
  const payload = {
    contact_name: companyName,
    company_name: companyName,
    email,
    phone,
    mobile: clientDoc?.phone, // Use same phone as mobile
    contact_type: clientDoc?.contactType || "customer",
    is_customer: true,
    customer_sub_type: clientDoc?.customerSubType || "business",
    website: clientDoc?.website || "",
    notes: clientDoc?.notes || "",
    legal_name: clientDoc?.legalName || "",
    payment_terms: clientDoc?.paymentTerms || 0,
    pan_no: clientDoc?.panNo || "",
    gst_no: clientDoc?.gstNo || "",
    credit_limit: clientDoc?.creditLimit || 0,
    is_portal_enabled: clientDoc?.isPortalEnabled || false,
    contact_persons: clientDoc?.contactPersons?.map(cp => ({
      salutation: cp.salutation || "",
      first_name: cp.first_name || "",
      last_name: cp.last_name || "",
      email: cp.email || "",
      phone: cp.phone || "",
      mobile: cp.phone || "", // Use same phone as mobile
      designation: cp.designation || "",
      department: cp.department || "",
      is_primary_contact: cp.is_primary_contact || false,
      enable_portal: cp.enable_portal || false
    })) || [],
    
    // Billing address from client data
    billing_address: clientDoc?.billingAddress ? {
      attention: clientDoc.billingAddress.attention || contactPerson || "",
      address: clientDoc.billingAddress.address || "",
      street2: clientDoc.billingAddress.street2 || "",
      city: clientDoc.billingAddress.city || "",
      state: clientDoc.billingAddress.state || "",
      zip: clientDoc.billingAddress.zip || "",
      country: clientDoc.billingAddress.country || "INDIA",
      phone: clientDoc.billingAddress.phone || clientDoc?.phone || ""
    } : {
      attention: contactPerson || "",
      country: "INDIA"
    },
    
    // Shipping address from client data
    shipping_address: clientDoc?.shippingAddress ? {
      attention: clientDoc.shippingAddress.attention || contactPerson || "",
      address: clientDoc.shippingAddress.address || "",
      street2: clientDoc.shippingAddress.street2 || "",
      city: clientDoc.shippingAddress.city || "",
      state: clientDoc.shippingAddress.state || "",
      zip: clientDoc.shippingAddress.zip || "",
      country: clientDoc.shippingAddress.country || "INDIA",
      phone: clientDoc.shippingAddress.phone || clientDoc?.phone || ""
    } : (clientDoc?.billingAddress ? {
      attention: clientDoc.billingAddress.attention || contactPerson || "",
      address: clientDoc.billingAddress.address || "",
      street2: clientDoc.billingAddress.street2 || "",
      city: clientDoc.billingAddress.city || "",
      state: clientDoc.billingAddress.state || "",
      zip: clientDoc.billingAddress.zip || "",
      country: clientDoc.billingAddress.country || "INDIA",
      phone: clientDoc.billingAddress.phone || clientDoc?.phone || ""
    } : {
      attention: contactPerson || "",
      country: "INDIA"
    })
  };

  const created = await createContact(payload);
  return created?.contact?.contact_id;
}

// -------------------
// Create invoice in Zoho
// -------------------
export async function createZohoInvoiceFromLocal(invoiceDoc) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceDoc),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error creating invoice:", err.message);
    throw err;
  }
}

export async function getZohoInvoicePdfUrl(invoiceId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");

    return data?.invoice?.invoice_url || null;
  } catch (err) {
    console.error("❌ Error fetching invoice PDF URL:", err.message);
    throw err;
  }
}
export async function sendZohoInvoiceEmail(invoiceId, emailPayload = {}) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}/email?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error sending Zoho Invoice Email:", err.message);
    throw err;
  }
}
export async function getZohoInvoice(invoiceId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data?.invoice || null;
  } catch (err) {
    console.error("❌ Error fetching Zoho Invoice:", err.message);
    throw err;
  }
}
// -------------------
// Record Payment for Zoho Invoice
// -------------------
export async function recordZohoPayment(invoiceId, paymentData) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}/payment?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error recording Zoho Payment:", err.message);
    throw err;
  }
}
