import fetch from "node-fetch";
import { getValidAccessToken } from "./zohoTokenManager.js";
import apiLogger from "./apiLogger.js";

const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID || "60047183737";
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
    delete sanitized.is_sms_enabled;
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
              removed.push(`contact_persons.${ck}`);
            }
          }
        }
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

export async function findOrCreateContactFromClient(clientDoc) {
  const email = clientDoc?.email;
  const companyName = clientDoc?.companyName || clientDoc?.contactPerson || "Unknown";
  const phone = clientDoc?.phone || undefined;
  const contactPerson = clientDoc?.contactPerson || undefined;

  if (email) {
    const contacts = await getContacts();
    const existing = contacts?.contacts?.find(c => c.email === email);
    if (existing) return existing.contact_id;
  }

  const payload = {
    contact_name: companyName,
    company_name: companyName,
    email,
    phone,
    mobile: clientDoc?.phone,
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
      mobile: cp.phone || "",
      designation: cp.designation || "",
      department: cp.department || "",
      is_primary_contact: cp.is_primary_contact || false,
      enable_portal: cp.enable_portal || false
    })) || [],
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

export async function createZohoInvoiceFromLocal(invoiceDoc, clientDoc) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices?organization_id=${ORG_ID}`;
    const {
      invoiceNumber,
      issueDate,
      dueDate,
      items = [],
      discount = {},
      notes = "",
      billingPeriod,
    } = invoiceDoc || {};
    
    // Use the correct field names from the invoice document
    const actualIssueDate = invoiceDoc.date || issueDate;
    const actualDueDate = invoiceDoc.due_date || dueDate;
    const customer_id = clientDoc?.zohoBooksContactId;
    if (!customer_id) {
      throw new Error("Client must have a zohoBooksContactId to create invoice in Zoho Books");
    }
    const itemsArray = invoiceDoc.line_items || items || [];
    const line_items = itemsArray.map((it) => ({
      name: it.name || it.description || "Item",
      description: it.description || it.name || "Item",
      rate: Number(it.rate || it.unitPrice || ((it.amount || it.item_total || 0) / (it.quantity || 1))),
      quantity: Number(it.quantity || 1),
      unit: it.unit || "nos",
      ...(it.item_id && it.item_id !== "goods" ? { item_id: it.item_id } : {})
    }));
    console.log("Formatted line_items for Zoho:", JSON.stringify(line_items, null, 2));
    if (!line_items || line_items.length === 0) {
      throw new Error("Invoice must have at least one line item to create in Zoho Books");
    }
    // Enrich payload with GST and terms to satisfy Zoho validations for IN region
    const payload = {
      customer_id,
      reference_number: invoiceDoc.invoice_number || invoiceNumber || undefined,
      date: actualIssueDate
        ? new Date(new Date(actualIssueDate).toDateString()).toISOString().slice(0, 10)
        : new Date(new Date().toDateString()).toISOString().slice(0, 10),
      ...(actualDueDate
        ? { due_date: new Date(new Date(actualDueDate).toDateString()).toISOString().slice(0, 10) }
        : {}),
      line_items,
      notes: invoiceDoc.notes || notes || "Looking forward for your business.",
      terms:
        billingPeriod && billingPeriod.start && billingPeriod.end
          ? `Billing Period: ${new Date(billingPeriod.start)
              .toISOString()
              .slice(0, 10)} to ${new Date(billingPeriod.end)
              .toISOString()
              .slice(0, 10)}`
          : "Terms & Conditions apply",
    };

    const headers = {
      Authorization: `Zoho-oauthtoken ${authToken}`,
      "Content-Type": "application/json",
    };
    const requestId = await apiLogger.logOutgoingCall({
      service: 'zoho_books',
      operation: 'create_invoice',
      method: 'POST',
      url,
      headers,
      requestBody: payload,
      userId: null,
      clientId: clientDoc?._id || null,
      relatedEntity: 'invoice',
      relatedEntityId: invoiceDoc?._id || null,
      attemptNumber: 1,
      maxAttempts: 1
    });

    let response;
    let data;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (_) {
        data = responseText;
      }

      await apiLogger.logResponse({
        requestId,
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: data,
        success: response.ok,
        errorMessage: response.ok ? null : (data?.message || `HTTP ${response.status}`)
      });

      if (!response.ok) {
        const errMsg = data?.message || data?.code || `Zoho API error (status ${response.status})`;
        console.error("ZohoBooks:createInvoice error payload:", typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
        throw new Error(errMsg);
      }
    } catch (err) {
      await apiLogger.logResponse({
        requestId,
        statusCode: 0,
        responseHeaders: {},
        responseBody: null,
        success: false,
        errorMessage: err.message
      });
      throw err;
    }

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
    console.error("Error fetching Zoho Invoice:", err.message);
    throw err;
  }
}

export async function recordZohoPayment(invoiceId, paymentData) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/customerpayments?organization_id=${ORG_ID}`;
    
    console.log("🔗 Zoho Payment URL:", url);
    console.log("📤 Payment payload:", JSON.stringify(paymentData, null, 2));
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentData),
    });
    const data = await res.json();
    
    console.log("📥 Zoho response:", JSON.stringify(data, null, 2));
    
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("Error recording Zoho Payment:", err.message);
    throw err;
  }
}

// ===== ZOHO BOOKS ITEMS API =====

export async function getZohoItems() {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/items?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error fetching Zoho items:", err.message);
    throw err;
  }
}

export async function createZohoItem(itemData) {
  const authToken = await getValidAccessToken();
  const url = `${BASE_URL}/items?organization_id=${ORG_ID}`;
  const startTime = Date.now();

  console.log("\n===== ZohoBooks:createItem - Request =====");
  console.log("URL:", url);
  console.log("Payload:", JSON.stringify(itemData, null, 2));

  const requestId = await apiLogger.logOutgoingCall({
    service: 'zoho_books',
    operation: 'create_item',
    method: 'POST',
    url,
    headers: { Authorization: `Zoho-oauthtoken ${authToken.slice(0, 8)}...` },
    requestBody: itemData,
    userId: null,
    clientId: null,
    relatedEntity: 'item',
    relatedEntityId: null,
    attemptNumber: 1,
    maxAttempts: 1
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemData),
    });

    const durationMs = Date.now() - startTime;
    const rawText = await res.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      data = { parse_error: String(e?.message || e), raw: rawText };
    }

    console.log("===== ZohoBooks:createItem - Response =====");
    console.log("HTTP:", res.status, res.statusText || "");
    console.log("Duration(ms):", durationMs);
    console.log("Body:", typeof data === "object" ? JSON.stringify(data, null, 2) : data);

    await apiLogger.logResponse({
      requestId,
      statusCode: res.status,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      responseBody: data,
      success: res.ok,
      errorMessage: res.ok ? null : (data?.message || `HTTP ${res.status}`)
    });

    if (!res.ok) {
      const errMsg = data?.message || data?.code || `Zoho API error (status ${res.status})`;
      console.error("❌ ZohoBooks:createItem failed:", errMsg);
      throw new Error(errMsg);
    }

    return data;
  } catch (err) {
    await apiLogger.logResponse({
      requestId,
      statusCode: 0,
      responseHeaders: {},
      responseBody: null,
      success: false,
      errorMessage: err.message
    });
    console.error("❌ [ZohoBooks] Error creating item:", err?.message || err);
    throw err;
  }
}

export async function updateZohoItem(itemId, itemData) {
  const authToken = await getValidAccessToken();
  const url = `${BASE_URL}/items/${itemId}?organization_id=${ORG_ID}`;
  const startTime = Date.now();

  console.log("\n===== ZohoBooks:updateItem - Request =====");
  console.log("URL:", url);
  console.log("Item ID:", itemId);
  console.log("Payload:", JSON.stringify(itemData, null, 2));

  const requestId = await apiLogger.logOutgoingCall({
    service: 'zoho_books',
    operation: 'update_item',
    method: 'PUT',
    url,
    headers: { Authorization: `Zoho-oauthtoken ${authToken.slice(0, 8)}...` },
    requestBody: itemData,
    userId: null,
    clientId: null,
    relatedEntity: 'item',
    relatedEntityId: itemId,
    attemptNumber: 1,
    maxAttempts: 1
  });

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemData),
    });

    const durationMs = Date.now() - startTime;
    const rawText = await res.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      data = { parse_error: String(e?.message || e), raw: rawText };
    }

    console.log("===== ZohoBooks:updateItem - Response =====");
    console.log("HTTP:", res.status, res.statusText || "");
    console.log("Duration(ms):", durationMs);
    console.log("Body:", typeof data === "object" ? JSON.stringify(data, null, 2) : data);

    await apiLogger.logResponse({
      requestId,
      statusCode: res.status,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      responseBody: data,
      success: res.ok,
      errorMessage: res.ok ? null : (data?.message || `HTTP ${res.status}`)
    });

    if (!res.ok) {
      const errMsg = data?.message || data?.code || `Zoho API error (status ${res.status})`;
      console.error("❌ ZohoBooks:updateItem failed:", errMsg);
      throw new Error(errMsg);
    }

    return data;
  } catch (err) {
    await apiLogger.logResponse({
      requestId,
      statusCode: 0,
      responseHeaders: {},
      responseBody: null,
      success: false,
      errorMessage: err.message
    });
    console.error("❌ [ZohoBooks] Error updating item:", err?.message || err);
    throw err;
  }
}

export async function getZohoItem(itemId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/items/${itemId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data?.item || null;
  } catch (err) {
    console.error("❌ Error fetching Zoho item:", err.message);
    throw err;
  }
}

export async function syncCreditCustomItemToZoho(creditCustomItem) {
  try {
    console.log("\n===== Syncing Credit Custom Item to Zoho =====");
    console.log("Item:", creditCustomItem.name, "| Mode:", creditCustomItem.pricingMode);

    // Prepare Zoho item payload
    const zohoItemData = {
      name: creditCustomItem.name,
      sku: creditCustomItem.code || undefined,
      unit: creditCustomItem.unit || "nos",
      description: `${creditCustomItem.name} - ${creditCustomItem.pricingMode === 'credits' ? `${creditCustomItem.unitCredits} credits` : `₹${creditCustomItem.unitPriceINR}`}`,
      rate: creditCustomItem.pricingMode === 'inr' ? creditCustomItem.unitPriceINR : 500, // Default credit value
      account_id: null, // Will use default sales account
      tax_id: creditCustomItem.taxable ? null : undefined, // Use default tax or no tax
      item_type: "sales",
      product_type: "service",
      is_taxable: creditCustomItem.taxable,
      tax_percentage: creditCustomItem.taxable ? creditCustomItem.gstRate : 0,
      purchase_rate: 0,
      purchase_account_id: null,
      inventory_account_id: null,
      status: creditCustomItem.active ? "active" : "inactive"
    };

    // Remove undefined fields
    Object.keys(zohoItemData).forEach(key => {
      if (zohoItemData[key] === undefined) {
        delete zohoItemData[key];
      }
    });

    let zohoResponse;
    
    if (creditCustomItem.zohoItemId) {
      // Update existing item
      console.log("Updating existing Zoho item:", creditCustomItem.zohoItemId);
      zohoResponse = await updateZohoItem(creditCustomItem.zohoItemId, zohoItemData);
    } else {
      // Create new item
      console.log("Creating new Zoho item");
      zohoResponse = await createZohoItem(zohoItemData);
      
      // Update local record with Zoho item ID
      if (zohoResponse?.item?.item_id) {
        creditCustomItem.zohoItemId = zohoResponse.item.item_id;
        await creditCustomItem.save();
        console.log("✅ Updated local item with Zoho ID:", zohoResponse.item.item_id);
      }
    }

    console.log("✅ Successfully synced item to Zoho Books");
    return zohoResponse;

  } catch (error) {
    console.error("❌ Error syncing credit custom item to Zoho:", error.message);
    throw error;
  }
}

export async function findZohoItemByName(itemName) {
  try {
    const items = await getZohoItems();
    return items?.items?.find(item => 
      item.name?.toLowerCase() === itemName?.toLowerCase() ||
      item.sku?.toLowerCase() === itemName?.toLowerCase()
    );
  } catch (err) {
    console.error("❌ Error finding Zoho item by name:", err.message);
    return null;
  }
}
