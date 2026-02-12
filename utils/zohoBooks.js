import fetch from "node-fetch";
import { getValidAccessToken } from "./zohoTokenManager.js";
import apiLogger from "./apiLogger.js";

const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID;
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
      "place_of_contact",
      "tax_info_list",
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

export async function updateContact(contactId, payload) {
  const authToken = await getValidAccessToken();
  const url = `${BASE_URL}/contacts/${contactId}?organization_id=${ORG_ID}`;
  const maskedToken = authToken ? `${String(authToken).slice(0, 8)}…` : undefined;
  const startTime = Date.now();

  console.log("\n===== ZohoBooks:updateContact - Request =====");
  console.log("URL:", url);
  console.log("Headers:", { Authorization: `Zoho-oauthtoken ${maskedToken}`, "Content-Type": "application/json" });
  console.log("Payload keys:", Object.keys(payload || {}));

  // Reuse the same sanitizer rules as createContact
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
      "place_of_contact",
      "tax_info_list",
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
      if (allowedKeys.has(k)) sanitized[k] = v; else removed.push(k);
    }
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
        "enable_portal",
      ]);
      sanitized.contact_persons = sanitized.contact_persons.map((cp) => {
        const out = {};
        if (cp && typeof cp === "object") {
          for (const [ck, cv] of Object.entries(cp)) {
            if (cpAllowed.has(ck)) out[ck] = cv; else removed.push(`contact_persons.${ck}`);
          }
        }
        delete out.is_sms_enabled;
        delete out.communication_preference;
        return out;
      });
    }
    if (removed.length) console.log("ZohoBooks:updateContact - stripped unsupported keys:", removed);
    return sanitized;
  };

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sanitizeContactPayload(payload)),
    });

    const durationMs = Date.now() - startTime;
    const rawText = await res.text();
    let data;
    try { data = rawText ? JSON.parse(rawText) : {}; } catch (e) { data = { parse_error: true, raw: rawText }; }

    console.log("===== ZohoBooks:updateContact - Response =====");
    console.log("HTTP:", res.status, res.statusText || "");
    console.log("Duration(ms):", durationMs);
    console.log("Body:", typeof data === "object" ? JSON.stringify(data, null, 2) : data);

    if (!res.ok) {
      const errMsg = data?.message || data?.code || `Zoho API error (status ${res.status})`;
      console.error("❌ ZohoBooks:updateContact failed:", errMsg);
      throw new Error(errMsg);
    }

    return data;
  } catch (err) {
    console.error("❌ [ZohoBooks] Error updating contact:", err?.message || err);
    throw err;
  }
}

export async function getContact(contactId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/contacts/${contactId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data?.contact || null;
  } catch (err) {
    console.error("❌ Error fetching Zoho contact:", err.message);
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

    console.log("🔗 Zoho Payment URL:", url);
    console.log("📤 Payment payload:", JSON.stringify(invoiceDoc, null, 2));

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

    // Derive default tax percent:
    // 1) If invoice explicitly has tax_total <= 0, treat as zero-tax
    // 2) Else use first line item's tax_percentage if provided
    // 3) Else fallback to 18
    const explicitTaxTotal = typeof invoiceDoc?.tax_total === 'number' ? Number(invoiceDoc.tax_total) : null;
    let defaultTaxPercent;
    if (explicitTaxTotal !== null && explicitTaxTotal <= 0) {
      defaultTaxPercent = 0;
    } else if (typeof itemsArray?.[0]?.tax_percentage === 'number') {
      defaultTaxPercent = Number(itemsArray[0].tax_percentage);
    } else {
      defaultTaxPercent = 18; // fallback to 18% for IN region
    }

    // GST treatment influences whether we should apply a tax or exemption
    const gstTreatment = invoiceDoc?.gst_treatment || clientDoc?.gstTreatment || 'business_gst';
    const zeroTax = !(Number(defaultTaxPercent) > 0);

    // Normalize Indian state codes/names to a comparable uppercase token
    const normalizeStateToken = (v) => {
      if (!v) return '';
      let s = String(v).trim().toUpperCase();
      // Handle common numeric GST codes -> alpha
      const numMap = {
        '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UT', '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR',
        '11': 'SK', '12': 'AR', '13': 'AS', '14': 'NL', '15': 'MN', '16': 'ML', '17': 'TR', '18': 'MZ', '19': 'WB', '20': 'JH',
        '21': 'OD', '22': 'CT', '23': 'MP', '24': 'GJ', '25': 'DD', '26': 'DN', '27': 'MH', '28': 'AP', '29': 'KA', '30': 'GA',
        '31': 'LD', '32': 'KL', '33': 'TN', '34': 'PY', '35': 'AN', '36': 'TS', '37': 'AP', '38': 'LA'
      };
      if (/^\d{2}$/.test(s) && numMap[s]) return numMap[s];
      // Strip any separators like 'IN-XX' or 'XX-YY'
      if (s.includes('-')) s = s.split('-').pop();
      s = s.replace(/[^A-Z]/g, '');
      // Map names and already-alpha codes
      const map = {
        'ANDAMAN AND NICOBAR': 'AN', 'ANDHRA PRADESH': 'AP', 'ARUNACHAL PRADESH': 'AR', 'ASSAM': 'AS', 'BIHAR': 'BR',
        'CHANDIGARH': 'CH', 'CHHATTISGARH': 'CT', 'DADRA AND NAGAR HAVELI': 'DN', 'DAMAN AND DIU': 'DD',
        'DELHI': 'DL', 'NCTOFDELHI': 'DL', 'GOA': 'GA', 'GUJARAT': 'GJ', 'HARYANA': 'HR', 'HIMACHAL PRADESH': 'HP',
        'JAMMU AND KASHMIR': 'JK', 'JHARKHAND': 'JH', 'KARNATAKA': 'KA', 'KERALA': 'KL', 'LADAKH': 'LA', 'LAKSHADWEEP': 'LD',
        'MADHYA PRADESH': 'MP', 'MAHARASHTRA': 'MH', 'MANIPUR': 'MN', 'MEGHALAYA': 'ML', 'MIZORAM': 'MZ', 'NAGALAND': 'NL',
        'ODISHA': 'OD', 'ORISSA': 'OD', 'PUDUCHERRY': 'PY', 'PUNJAB': 'PB', 'RAJASTHAN': 'RJ', 'SIKKIM': 'SK',
        'TAMIL NADU': 'TN', 'TELANGANA': 'TS', 'TRIPURA': 'TR', 'UTTAR PRADESH': 'UP', 'UTTARAKHAND': 'UK', 'WEST BENGAL': 'WB',
        // Already-alpha codes should map to themselves
        'AN': 'AN', 'AP': 'AP', 'AR': 'AR', 'AS': 'AS', 'BR': 'BR', 'CH': 'CH', 'CT': 'CT', 'DD': 'DD', 'DL': 'DL', 'DN': 'DN', 'GA': 'GA', 'GJ': 'GJ', 'HP': 'HP', 'HR': 'HR', 'JH': 'JH', 'JK': 'JK', 'KA': 'KA', 'KL': 'KL', 'LA': 'LA', 'LD': 'LD', 'MH': 'MH', 'ML': 'ML', 'MN': 'MN', 'MP': 'MP', 'MZ': 'MZ', 'NL': 'NL', 'OD': 'OD', 'PB': 'PB', 'PY': 'PY', 'RJ': 'RJ', 'SK': 'SK', 'TN': 'TN', 'TR': 'TR', 'TS': 'TS', 'UK': 'UK', 'UP': 'UP', 'WB': 'WB'
      };
      return map[s] || s;
    };

    // Derive place_of_supply if missing on invoice from client billing address
    const derivedPlaceOfSupply = invoiceDoc?.place_of_supply
      || clientDoc?.place_of_supply
      || clientDoc?.billingAddress?.state_code
      || clientDoc?.billingAddress?.state
      || '';

    // Fetch organization taxes to map a percentage to a Zoho tax_id (or tax group id)
    async function getZohoTaxesList() {
      const authToken = await getValidAccessToken();
      if (!ORG_ID) throw new Error('ZOHO_ORG_ID (or ZOHO_BOOKS_ORG_ID) is not configured');
      const url = `${BASE_URL}/settings/taxes?organization_id=${ORG_ID}`;
      const res = await fetch(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { parse_error: true, raw: text }; }
      if (!res.ok) {
        const msg = data?.message || `Failed to fetch Zoho taxes (status ${res.status})`;
        console.warn('[ZohoBooks] getZohoTaxesList error:', msg);
        return { taxes: [], taxgroups: [] };
      }
      // Standardize keys
      const taxes = Array.isArray(data?.taxes) ? data.taxes : [];
      const tax_groups = Array.isArray(data?.tax_groups) ? data.tax_groups : [];
      return { taxes, taxgroups: tax_groups };
    }

    function pickTaxForRate({ taxes, taxgroups }, rate, isInterstate) {
      if (!rate || rate <= 0) return null;
      const norm = (v) => Number(v);
      // Helper to check rate equality with tolerance
      const rateEq = (r, x) => typeof r === 'number' && !Number.isNaN(r) && Math.abs(r - x) < 0.001;

      // Prefer IGST (single tax) for interstate
      if (isInterstate) {
        const matchIgst = taxes.find((t) => {
          const r = norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage);
          const name = String(t?.tax_name || t?.name || '').toUpperCase();
          return rateEq(r, rate) && (name.includes('IGST') || name.includes('INTEGRATED'));
        });
        if (matchIgst?.tax_id) return { kind: 'tax', id: matchIgst.tax_id };
        // fallback to any single tax with same rate
        const anyTax = taxes.find((t) => rateEq(norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage), rate));
        if (anyTax?.tax_id) return { kind: 'tax', id: anyTax.tax_id };
        // Do not use group for interstate (Zoho expects IGST)
        return null;
      }

      // Intrastate: prefer tax group (CGST+SGST) matching total rate
      const matchGroup = taxgroups.find((g) => rateEq(norm(g?.tax_percentage ?? g?.rate ?? g?.tax_rate ?? g?.percentage), rate));
      if (matchGroup?.tax_group_id) return { kind: 'group', id: matchGroup.tax_group_id };
      // Fallback: if no group, try single tax (some orgs configure combined GST as single tax)
      const matchTax = taxes.find((t) => rateEq(norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage), rate));
      if (matchTax?.tax_id) return { kind: 'tax', id: matchTax.tax_id };
      return null;
    }

    // Only fetch/apply tax when GST treatment is business_gst AND tax rate > 0
    let chosenTax = null;
    // Normalize org and POS codes up-front for reuse
    const orgStateRaw = (invoiceDoc?.organization_state_code || process.env.ZOHO_ORG_STATE_CODE || '').trim();
    const orgStateCode = normalizeStateToken(orgStateRaw);
    const posRaw = (derivedPlaceOfSupply || '').trim();
    let posCode = normalizeStateToken(posRaw);
    if (!posCode) {
      // Fallback: use org state code to avoid Zoho 'Please provide a valid state code' error
      posCode = orgStateCode;
    }

    if (!zeroTax) {
      const { taxes, taxgroups } = await getZohoTaxesList();
      // Determine interstate based on org state vs place of supply
      const isInterstate = !!(orgStateCode && posCode && orgStateCode !== posCode);
      chosenTax = pickTaxForRate({ taxes, taxgroups }, defaultTaxPercent, isInterstate);
      // Fallback: if still no tax, pick a reasonable default to satisfy Zoho (any group for intrastate, any tax for interstate)
      if (!chosenTax) {
        if (isInterstate) {
          // Prefer any single tax
          const anyTax = Array.isArray(taxes) && taxes.length > 0 ? taxes[0] : null;
          if (anyTax?.tax_id) chosenTax = { kind: 'tax', id: anyTax.tax_id };
        } else {
          // Prefer any group (CGST+SGST); else any single tax
          const anyGroup = Array.isArray(taxgroups) && taxgroups.length > 0 ? taxgroups[0] : null;
          if (anyGroup?.tax_group_id) chosenTax = { kind: 'group', id: anyGroup.tax_group_id };
          if (!chosenTax) {
            const anyTax = Array.isArray(taxes) && taxes.length > 0 ? taxes[0] : null;
            if (anyTax?.tax_id) chosenTax = { kind: 'tax', id: anyTax.tax_id };
          }
        }
      }
      try {
        console.log('[ZohoBooks] Taxes count:', taxes?.length || 0, 'TaxGroups count:', taxgroups?.length || 0, 'DefaultTax%:', defaultTaxPercent, 'isInterstate:', isInterstate, 'ChosenTax:', chosenTax, 'orgState:', orgStateCode, 'pos:', posCode);
      } catch (_) { }
      if (!chosenTax) {
        console.warn(`[ZohoBooks] No matching tax could be selected. Ensure taxes are configured in Zoho Books.`);
      }
    }

    // Compute a safe place_of_supply code for payload usage
    const placeOfSupplyCode = (typeof posCode !== 'undefined' && posCode)
      ? posCode
      : (normalizeStateToken((derivedPlaceOfSupply || '').trim())
        || normalizeStateToken((invoiceDoc?.place_of_supply || '').trim())
        || normalizeStateToken((process.env.ZOHO_ORG_STATE_CODE || '').trim()));

    const line_items = itemsArray.map((it) => {
      const li = {
        name: it.name || it.description || "Item",
        description: it.description || it.name || "Item",
        rate: Number(it.rate || it.unitPrice || ((it.amount || it.item_total || 0) / (it.quantity || 1))),
        quantity: Number(it.quantity || 1),
        unit: it.unit || "nos",
        ...(it.item_id && it.item_id !== "goods" ? { item_id: it.item_id } : {})
      };
      const perItemRate = typeof it.tax_percentage === 'number' ? Number(it.tax_percentage) : defaultTaxPercent;
      // Attach item-level tax only when a single tax is chosen (tax groups cannot be attached at item-level)
      if (perItemRate > 0 && chosenTax && chosenTax.kind === 'tax') {
        li.tax_id = chosenTax.id;
      }
      return li;
    });
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
      // GST context for India: let Zoho compute IGST vs CGST/SGST based on place_of_supply and org state
      ...(gstTreatment ? { gst_treatment: gstTreatment } : {}),
      ...(placeOfSupplyCode ? { place_of_supply: placeOfSupplyCode } : {}),
      // Force the GST registration number to match the selected client registration for this invoice
      ...(invoiceDoc?.gst_no ? { gst_no: invoiceDoc.gst_no } : (clientDoc?.gstNo ? { gst_no: clientDoc.gstNo } : {})),
      // Apply common tax_id at invoice level so Zoho knows a Tax is set (only when business_gst & non-zero)
      ...(!zeroTax && chosenTax
        ? (chosenTax.kind === 'tax' ? { tax_id: chosenTax.id } : { tax_group_id: chosenTax.id })
        : {}),
      // No automatic tax_exemption_id — enforce GST application as per user's policy
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
      } catch (e) {
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

        // Fallback: if Zoho insists IGST must be applied, retry with IGST (single tax_id) instead of CGST/SGST group
        const msgStr = String(errMsg || '').toLowerCase();
        const isIgstError = msgStr.includes('igst has to be applied');
        const wasGroupSelected = !!payload.tax_group_id && !payload.tax_id;
        if (isIgstError) {
          try {
            // Fetch taxes to pick an IGST tax matching our rate
            const { taxes } = await (async () => {
              try { return await getZohoTaxesList(); } catch { return { taxes: [], taxgroups: [] }; }
            })();
            const norm = (v) => Number(v);
            const rateEq = (r, x) => typeof r === 'number' && !Number.isNaN(r) && Math.abs(r - x) < 0.001;
            const findIgst = (r) => taxes.find((t) => {
              const tr = norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage);
              const name = String(t?.tax_name || t?.name || '').toUpperCase();
              return rateEq(tr, r) && (name.includes('IGST') || name.includes('INTEGRATED'));
            });
            const igstTax = findIgst(defaultTaxPercent) || taxes.find((t) => rateEq(norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage), defaultTaxPercent));

            if (igstTax?.tax_id) {
              const retryPayload = {
                ...payload,
                tax_group_id: undefined,
                tax_id: igstTax.tax_id,
                line_items: Array.isArray(payload.line_items)
                  ? payload.line_items.map((li) => ({ ...li, tax_id: igstTax.tax_id }))
                  : payload.line_items
              };

              const retryRes = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(retryPayload)
              });
              const retryText = await retryRes.text();
              let retryData;
              try { retryData = retryText ? JSON.parse(retryText) : {}; } catch { retryData = retryText; }

              await apiLogger.logResponse({
                requestId,
                statusCode: retryRes.status,
                responseHeaders: Object.fromEntries(retryRes.headers.entries()),
                responseBody: retryData,
                success: retryRes.ok,
                errorMessage: retryRes.ok ? null : (retryData?.message || `HTTP ${retryRes.status}`)
              });

              if (retryRes.ok) {
                return retryData;
              }
            }
          } catch (retryErr) {
            console.warn('[ZohoBooks] IGST fallback retry failed:', retryErr?.message || retryErr);
          }
        }

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
      throw err;
    }
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
    return data?.invoice?.pdf_url || null;
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

// Fetch raw PDF bytes for one or more Zoho invoice IDs via the bulk PDF endpoint.
// For our use case, we pass a single zohoInvoiceId.
export async function fetchZohoInvoicePdfBinary(zohoInvoiceId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/pdf?organization_id=${ORG_ID}&invoice_ids=${encodeURIComponent(zohoInvoiceId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });

    const arrayBuf = await res.arrayBuffer();
    if (!res.ok) {
      let errJson;
      try {
        errJson = JSON.parse(Buffer.from(arrayBuf).toString("utf8"));
      } catch (_) {
        errJson = null;
      }
      throw new Error((errJson && errJson.message) || `Zoho API error (status ${res.status})`);
    }

    const buffer = Buffer.from(arrayBuf);
    const contentType = res.headers.get("content-type") || "application/pdf";
    const contentDisposition = res.headers.get("content-disposition") || `attachment; filename="invoice.pdf"`;
    return { buffer, contentType, contentDisposition };
  } catch (err) {
    console.error("❌ Error fetching Zoho invoice PDF binary:", err.message);
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

// Create a public share link for an invoice. Returns the share URL string if successful.
export async function shareZohoInvoice(invoiceId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}/share?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.message || "Zoho API error (share)";
      console.warn("Zoho share POST failed:", errMsg);
      try {
        const getRes = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
        });
        const getData = await getRes.json();
        if (getRes.ok) {
          return getData?.share_link?.url || null;
        }
      } catch (_) {
        // ignore secondary failure, throw original
      }
      throw new Error(errMsg);
    }
    // Expected response shape: { share_link: { url: "https://..." } }
    return data?.share_link?.url || null;
  } catch (err) {
    console.error("❌ Error creating Zoho invoice share link:", err.message);
    throw err;
  }
}

// Convenience: fetch portal invoice_url and attempt to create a public share URL.
export async function getZohoInvoiceLinks(invoiceId) {
  const result = { portalUrl: null, publicShareUrl: null };
  try {
    const invoice = await getZohoInvoice(invoiceId);
    result.portalUrl = invoice?.invoice_url || null;
  } catch (e) {
    // Non-fatal; we still might create a share link
    console.warn("Could not fetch invoice for portalUrl:", e?.message || e);
  }

  try {
    const shareUrl = await shareZohoInvoice(invoiceId);
    result.publicShareUrl = shareUrl || null;
  } catch (e) {
    // If already shared or any error, we keep publicShareUrl as null and let caller decide next steps
    console.warn("Could not create public share link:", e?.message || e);
  }

  return result;
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

// ===== Customer Payments helpers (apply/refund excess) =====
export async function getZohoCustomerPayment(paymentId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/customerpayments/${paymentId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data?.payment || null;
  } catch (err) {
    console.error("❌ Error fetching Zoho customer payment:", err.message);
    throw err;
  }
}

export async function updateZohoCustomerPayment(paymentId, payload) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/customerpayments/${paymentId}?organization_id=${ORG_ID}`;
    // Debug: log exact URL and payload being sent to Zoho
    try {
      console.log('[Zoho:updateCustomerPayment] URL:', url);
      console.log('[Zoho:updateCustomerPayment] Payload:', JSON.stringify(payload, null, 2));
    } catch (_) { }
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error updating Zoho customer payment:", err.message);
    throw err;
  }
}

export async function refundZohoExcessPayment(paymentId, refundPayload) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/customerpayments/${paymentId}/refunds?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(refundPayload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data;
  } catch (err) {
    console.error("❌ Error refunding Zoho excess payment:", err.message);
    throw err;
  }
}

// ===== ZOHO BOOKS INVOICES API =====

export async function markZohoInvoiceAsSent(invoiceId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/invoices/${invoiceId}/status/sent?organization_id=${ORG_ID}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${authToken}`,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.message || "Zoho API error (mark as sent)";
      console.error("❌ Error marking Zoho invoice as sent:", errMsg);
      throw new Error(errMsg);
    }
    return data;
  } catch (err) {
    console.error("❌ Error in markZohoInvoiceAsSent:", err.message);
    throw err;
  }
}

export async function getZohoTaxes() {
  try {
    const authToken = await getValidAccessToken();
    if (!ORG_ID) throw new Error('ZOHO_ORG_ID (or ZOHO_BOOKS_ORG_ID) is not configured');
    const url = `${BASE_URL}/settings/taxes?organization_id=${ORG_ID}`;
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { parse_error: true, raw: text }; }
    if (!res.ok) {
      const errMsg = data?.message || `Zoho API error fetching taxes (status ${res.status})`;
      throw new Error(errMsg);
    }
    // Standardize keys
    const taxes = Array.isArray(data?.taxes) ? data.taxes : [];
    const tax_groups = Array.isArray(data?.tax_groups) ? data.tax_groups : [];
    return { taxes, taxgroups: tax_groups };
  } catch (err) {
    console.error("❌ Error fetching Zoho taxes:", err.message);
    throw err;
  }
}

// getZohoWithholdingTaxes removed (TDS disabled)

// Public utility: fetch taxes and tax groups from Zoho Books for the configured organization
// export async function getZohoTaxes() {
//   const authToken = await getValidAccessToken();
//   if (!ORG_ID) throw new Error('ZOHO_ORG_ID (or ZOHO_BOOKS_ORG_ID) is not configured');
//   const url = `${BASE_URL}/taxes?organization_id=${ORG_ID}`;
//   const res = await fetch(url, { method: 'GET', headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
//   const text = await res.text();
//   let data;
//   try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { parse_error: true, raw: text }; }
//   if (!res.ok) {
//     const errMsg = data?.message || `Zoho API error fetching taxes (status ${res.status})`;
//     throw new Error(errMsg);
//   }
//   // Standardize keys
//   const taxes = Array.isArray(data?.taxes) ? data.taxes : [];
//   const tax_groups = Array.isArray(data?.tax_groups) ? data.tax_groups : [];
//   return { taxes, tax_groups };
// }

export async function createZohoEstimateFromLocal(estimateDoc, clientDoc) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/estimates?organization_id=${ORG_ID}`;

    const {
      estimate_number,
      date,
      expiry_date,
      line_items = [],
      notes = "",
      billingPeriod,
    } = estimateDoc || {};

    const customer_id = clientDoc?.zohoBooksContactId;
    if (!customer_id) {
      throw new Error("Client must have a zohoBooksContactId to create estimate in Zoho Books");
    }

    const itemsArray = estimateDoc.line_items || line_items || [];
    const defaultTaxPercent =
      typeof itemsArray?.[0]?.tax_percentage === "number" && itemsArray?.[0]?.tax_percentage >= 0
        ? Number(itemsArray[0].tax_percentage)
        : 18; // default GST 18%

    const gstTreatment = estimateDoc?.gst_treatment || "business_gst";
    const zeroTax = !(Number(defaultTaxPercent) > 0);

    // Normalize place_of_supply to valid two-letter Indian state code (e.g., MH, DL)
    function normalizePlaceOfSupply(raw) {
      if (!raw || typeof raw !== 'string') return null;
      let s = raw.trim().toUpperCase();
      if (s.includes('-')) s = s.split('-').pop();
      s = s.replace(/[^A-Z]/g, '');
      // Map names and already-alpha codes
      const VALID_CODES = new Set([
        'AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CT', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UP', 'WB'
      ]);
      if (VALID_CODES.has(s)) return s === 'OR' ? 'OD' : s;
      const NAME_TO_CODE = {
        'ANDAMAN AND NICOBAR': 'AN', 'ANDHRA PRADESH': 'AP', 'ARUNACHAL PRADESH': 'AR', 'ASSAM': 'AS', 'BIHAR': 'BR',
        'CHANDIGARH': 'CH', 'CHHATTISGARH': 'CT', 'DADRA AND NAGAR HAVELI': 'DN', 'DAMAN AND DIU': 'DD', 'DELHI': 'DL',
        'GOA': 'GA', 'GUJARAT': 'GJ', 'HARYANA': 'HR', 'HIMACHAL PRADESH': 'HP', 'JAMMU AND KASHMIR': 'JK', 'JHARKHAND': 'JH',
        'KARNATAKA': 'KA', 'KERALA': 'KL', 'LADAKH': 'LA', 'LAKSHADWEEP': 'LD', 'MADHYA PRADESH': 'MP', 'MAHARASHTRA': 'MH',
        'MANIPUR': 'MN', 'MEGHALAYA': 'ML', 'MIZORAM': 'MZ', 'NAGALAND': 'NL', 'ODISHA': 'OD', 'UTTARAKHAND': 'UK', 'PUDUCHERRY': 'PY',
        'PUNJAB': 'PB', 'RAJASTHAN': 'RJ', 'SIKKIM': 'SK', 'TAMIL NADU': 'TN', 'TELANGANA': 'TS', 'TRIPURA': 'TR', 'UTTAR PRADESH': 'UP', 'WEST BENGAL': 'WB'
      };
      for (const [name, code] of Object.entries(NAME_TO_CODE)) { if (s.includes(name)) return code; }
      return null;
    }
    const orgStateCode = normalizePlaceOfSupply((estimateDoc?.organization_state_code || process.env.ZOHO_ORG_STATE_CODE || '').trim());
    let normalizedPOS = normalizePlaceOfSupply(estimateDoc?.place_of_supply);
    if (!normalizedPOS && clientDoc) {
      const til = Array.isArray(clientDoc.taxInfoList) ? clientDoc.taxInfoList : [];
      const primary = til.find((t) => t.is_primary) || til[0];
      normalizedPOS = normalizePlaceOfSupply(primary?.place_of_supply)
        || normalizePlaceOfSupply(clientDoc?.billingAddress?.state_code)
        || normalizePlaceOfSupply(clientDoc?.billingAddress?.state);
    }

    async function getZohoTaxesList() {
      const authToken = await getValidAccessToken();
      if (!ORG_ID) throw new Error("ZOHO_ORG_ID (or ZOHO_BOOKS_ORG_ID) is not configured");
      const url = `${BASE_URL}/settings/taxes?organization_id=${ORG_ID}`;
      const res = await fetch(url, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { parse_error: true, raw: text }; }
      if (!res.ok) {
        const msg = data?.message || `Failed to fetch Zoho taxes (status ${res.status})`;
        console.warn("[ZohoBooks] getZohoTaxesList error:", msg);
        return { taxes: [], taxgroups: [] };
      }
      const taxes = Array.isArray(data?.taxes) ? data.taxes : [];
      const tax_groups = Array.isArray(data?.tax_groups) ? data.tax_groups : [];
      return { taxes, taxgroups: tax_groups };
    }

    function pickTaxForRate({ taxes, taxgroups }, rate, isInterstate) {
      if (!rate || rate <= 0) return null;
      const norm = (v) => Number(v);
      const rateEq = (r, x) => typeof r === "number" && !Number.isNaN(r) && Math.abs(r - x) < 0.001;
      if (isInterstate) {
        const matchIgst = taxes.find((t) => {
          const r = norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage);
          const name = String(t?.tax_name || t?.name || "").toUpperCase();
          return rateEq(r, rate) && (name.includes("IGST") || name.includes("INTEGRATED"));
        });
        if (matchIgst?.tax_id) return { kind: "tax", id: matchIgst.tax_id };
        const anyTax = taxes.find((t) => rateEq(norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage), rate));
        if (anyTax?.tax_id) return { kind: "tax", id: anyTax.tax_id };
        return null;
      }
      const matchGroup = taxgroups.find((g) => rateEq(norm(g?.tax_percentage ?? g?.rate ?? g?.tax_rate ?? g?.percentage), rate));
      if (matchGroup?.tax_group_id) return { kind: "group", id: matchGroup.tax_group_id };
      const matchTax = taxes.find((t) => rateEq(norm(t?.tax_percentage ?? t?.rate ?? t?.tax_rate ?? t?.percentage), rate));
      if (matchTax?.tax_id) return { kind: "tax", id: matchTax.tax_id };
      return null;
    }

    let chosenTax = null;
    if (!zeroTax) {
      const { taxes, taxgroups } = await getZohoTaxesList();
      let isInterstate;
      if (orgStateCode && normalizedPOS) {
        isInterstate = orgStateCode !== normalizedPOS;
      } else if (!orgStateCode && normalizedPOS) {
        // If org state unknown but POS known, default to interstate to satisfy Zoho
        isInterstate = true;
      } else {
        isInterstate = false;
      }
      chosenTax = pickTaxForRate({ taxes, taxgroups }, defaultTaxPercent, isInterstate);
      // Robust fallback like invoice flow
      if (!chosenTax) {
        if (isInterstate) {
          const anyTax = Array.isArray(taxes) && taxes.length > 0 ? taxes[0] : null;
          if (anyTax?.tax_id) chosenTax = { kind: 'tax', id: anyTax.tax_id };
        } else {
          const anyGroup = Array.isArray(taxgroups) && taxgroups.length > 0 ? taxgroups[0] : null;
          if (anyGroup?.tax_group_id) chosenTax = { kind: 'group', id: anyGroup.tax_group_id };
          if (!chosenTax) {
            const anyTax = Array.isArray(taxes) && taxes.length > 0 ? taxes[0] : null;
            if (anyTax?.tax_id) chosenTax = { kind: 'tax', id: anyTax.tax_id };
          }
        }
      }
      try { console.log("[ZohoBooks][Estimate] Tax selection:", { defaultTaxPercent, isInterstate, chosenTax, orgStateCode, pos: normalizedPOS }); } catch (_) { }
    }

    const liFormatted = itemsArray.map((it) => {
      const li = {
        name: it.name || it.description || "Item",
        description: it.description || it.name || "Item",
        rate: Number(it.rate || it.unitPrice || ((it.amount || it.item_total || 0) / (it.quantity || 1))),
        quantity: Number(it.quantity || 1),
        unit: it.unit || "nos",
        ...(it.item_id && it.item_id !== "goods" ? { item_id: it.item_id } : {})
      };
      const perItemRate = typeof it.tax_percentage === "number" ? Number(it.tax_percentage) : defaultTaxPercent;
      // Attach item-level tax only when a single tax is chosen (tax groups cannot be attached at item-level)
      if (perItemRate > 0 && chosenTax && chosenTax.kind === 'tax') {
        li.tax_id = chosenTax.id;
      }
      return li;
    });

    if (!liFormatted || liFormatted.length === 0) {
      throw new Error("Estimate must have at least one line item to create in Zoho Books");
    }

    const bp = estimateDoc?.billing_period || billingPeriod;
    const payload = {
      customer_id,
      reference_number: estimateDoc.estimate_number || estimate_number || undefined,
      date: date ? new Date(new Date(date).toDateString()).toISOString().slice(0, 10) : new Date(new Date().toDateString()).toISOString().slice(0, 10),
      ...(expiry_date ? { expiry_date: new Date(new Date(expiry_date).toDateString()).toISOString().slice(0, 10) } : {}),
      line_items: liFormatted,
      notes: estimateDoc.notes || notes || "Thank you for your interest.",
      terms:
        bp && bp.start && bp.end
          ? `Billing Period: ${new Date(bp.start)
            .toISOString()
            .slice(0, 10)} to ${new Date(bp.end)
              .toISOString()
              .slice(0, 10)}`
          : "Terms & Conditions apply",
      ...(estimateDoc?.gst_treatment ? { gst_treatment: estimateDoc.gst_treatment } : {}),
      ...(normalizedPOS ? { place_of_supply: normalizedPOS } : {}),
      ...(estimateDoc?.gst_no ? { gst_no: estimateDoc.gst_no } : {}),
      ...(!zeroTax && chosenTax
        ? (chosenTax.kind === "tax" ? { tax_id: chosenTax.id } : { tax_group_id: chosenTax.id })
        : {}),
      // No automatic tax_exemption_id — enforce GST application as per user's policy
    };

    const headers = {
      Authorization: `Zoho-oauthtoken ${authToken}`,
      "Content-Type": "application/json",
    };
    const requestId = await apiLogger.logOutgoingCall({
      service: "zoho_books",
      operation: "create_estimate",
      method: "POST",
      url,
      headers,
      requestBody: payload,
      userId: null,
      clientId: clientDoc?._id || null,
      relatedEntity: 'invoice',
      relatedEntityId: estimateDoc?._id || null,
      attemptNumber: 1,
      maxAttempts: 1,
    });

    let response;
    let data;
    try {
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const responseText = await response.text();
      try { data = responseText ? JSON.parse(responseText) : {}; } catch (e) { data = responseText; }

      await apiLogger.logResponse({
        requestId,
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: data,
        success: response.ok,
        errorMessage: response.ok ? null : (data?.message || `HTTP ${response.status}`),
      });

      if (!response.ok) {
        const errMsg = data?.message || data?.code || `Zoho API error (status ${response.status})`;
        console.error("ZohoBooks:createEstimate error payload:", typeof data === "object" ? JSON.stringify(data, null, 2) : data);
        throw new Error(errMsg);
      }

      return data;
    } catch (err) {
      await apiLogger.logResponse({ requestId, statusCode: 0, responseHeaders: {}, responseBody: null, success: false, errorMessage: err.message });
      throw err;
    }
  } catch (err) {
    console.error("❌ Error creating estimate:", err.message);
    throw err;
  }
}

export async function getZohoEstimate(estimateId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/estimates/${estimateId}?organization_id=${ORG_ID}`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error");
    return data?.estimate || null;
  } catch (err) {
    console.error("❌ Error fetching Zoho estimate:", err.message);
    throw err;
  }
}


export async function markZohoEstimateAsSent(estimateId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/estimates/${estimateId}/status/sent?organization_id=${ORG_ID}`;
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${authToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Zoho API error (mark sent)");
    return data;
  } catch (err) {
    console.error("❌ Error marking estimate as sent:", err.message);
    throw err;
  }
}

export async function fetchZohoEstimatePdfBinary(zohoEstimateId) {
  try {
    const authToken = await getValidAccessToken();
    const url = `${BASE_URL}/estimates/pdf?organization_id=${ORG_ID}&estimate_ids=${encodeURIComponent(zohoEstimateId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${authToken}` },
    });

    const arrayBuf = await res.arrayBuffer();
    if (!res.ok) {
      let errJson;
      try {
        errJson = JSON.parse(Buffer.from(arrayBuf).toString("utf8"));
      } catch (_) {
        errJson = null;
      }
      throw new Error(errJson?.message || `Zoho API error fetching Estimate PDF (status ${res.status})`);
    }

    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error("❌ Error fetching Zoho Estimate PDF:", err.message);
    throw err;
  }
}
