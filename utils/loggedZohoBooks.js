import apiLogger from './apiLogger.js';
import { getValidAccessToken } from './zohoTokenManager.js';
import { createZohoInvoiceFromLocal } from './zohoBooks.js';


const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID || "60047183737";
const BASE_URL = "https://www.zohoapis.in/books/v3";


/**
 * Logged wrapper for Zoho Books API calls
 */
class LoggedZohoBooks {
  constructor() {
    this.service = 'zoho_books';
  }

  /**
   * Get contacts with logging
   */
  async getContacts({ userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'get_contacts',
      userId,
      clientId,
      relatedEntity: 'client',
      relatedEntityId: clientId,
      maxAttempts: 2
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/contacts?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data;
    } catch (error) {
      console.error('❌ Error fetching contacts:', error.message);
      throw error;
    }
  }

  /**
   * Create contact with logging
   */
  async createContact(payload, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'create_contact',
      userId,
      clientId,
      relatedEntity: 'client',
      relatedEntityId: clientId,
      maxAttempts: 3,
      retryCondition: (response, responseBody) => {
        // Retry on server errors and rate limits
        if (response?.status >= 500) return true;
        if (response?.status === 429) return true;
        return false;
      }
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/contacts?organization_id=${ORG_ID}`;

      const sanitizedPayload = this._sanitizeContactPayload(payload);

      const response = await loggedFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sanitizedPayload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.code || `Zoho API error (status ${response.status})`);
      }

      return data;
    } catch (error) {
      console.error('❌ [ZohoBooks] Error creating contact:', error?.message || error);
      throw error;
    }
  }

  /**
   * Create invoice with logging
   */
  async createInvoice(invoicePayload, { userId = null, clientId = null, invoiceId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'create_invoice',
      userId,
      clientId,
      relatedEntity: 'invoice',
      relatedEntityId: invoiceId,
      maxAttempts: 3
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/invoices?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(invoicePayload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data;
    } catch (error) {
      console.error('❌ Error creating invoice:', error.message);
      throw error;
    }
  }

  /**
   * Record customer payment with logging
   */
  async recordCustomerPayment(paymentPayload, { userId = null, clientId = null, paymentId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'record_payment',
      userId,
      clientId,
      relatedEntity: 'payment',
      relatedEntityId: paymentId,
      maxAttempts: 3
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/customerpayments?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentPayload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data;
    } catch (error) {
      console.error('Error recording Zoho Payment:', error.message);
      throw error;
    }
  }

  /**
   * Get invoice with logging
   */
  async getInvoice(invoiceId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'get_invoice',
      userId,
      clientId,
      relatedEntity: 'invoice',
      relatedEntityId: invoiceId,
      maxAttempts: 2
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/invoices/${invoiceId}?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data?.invoice || null;
    } catch (error) {
      console.error('Error fetching Zoho Invoice:', error.message);
      throw error;
    }
  }

  /**
   * Get invoice PDF URL with logging
   */
  async getInvoicePdfUrl(invoiceId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'get_invoice_pdf',
      userId,
      clientId,
      relatedEntity: 'invoice',
      relatedEntityId: invoiceId,
      maxAttempts: 2
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/invoices/${invoiceId}?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data?.invoice?.invoice_url || null;
    } catch (error) {
      console.error('❌ Error fetching invoice PDF URL:', error.message);
      throw error;
    }
  }

  /**
   * Send invoice email with logging
   */
  async sendInvoiceEmail(invoiceId, emailPayload = {}, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'send_invoice_email',
      userId,
      clientId,
      relatedEntity: 'invoice',
      relatedEntityId: invoiceId,
      maxAttempts: 2
    });

    try {
      const authToken = await getValidAccessToken();
      const url = `${BASE_URL}/invoices/${invoiceId}/email?organization_id=${ORG_ID}`;

      const response = await loggedFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailPayload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data;
    } catch (error) {
      console.error('❌ Error sending Zoho Invoice Email:', error.message);
      throw error;
    }
  }

  /**
   * List customer payments with logging
   */
  async listCustomerPayments(queryParams = {}, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'list_payments',
      userId,
      clientId,
      relatedEntity: 'payment',
      maxAttempts: 2
    });

    try {
      const authToken = await getValidAccessToken();
      const params = new URLSearchParams({
        organization_id: ORG_ID,
        ...queryParams
      });
      const url = `${BASE_URL}/customerpayments?${params.toString()}`;

      const response = await loggedFetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Zoho API error');
      }

      return data;
    } catch (error) {
      console.error('Error listing customer payments:', error.message);
      throw error;
    }
  }

  /**
   * Find or create contact from client data
   */
  async findOrCreateContactFromClient(clientDoc, { userId = null } = {}) {
    const email = clientDoc?.email;
    const companyName = clientDoc?.companyName || clientDoc?.contactPerson || "Unknown";
    const clientId = clientDoc?._id;

    if (email) {
      const contacts = await this.getContacts({ userId, clientId });
      const existing = contacts?.contacts?.find(c => c.email === email);
      if (existing) return existing.contact_id;
    }

    const payload = this._buildContactPayload(clientDoc);
    const created = await this.createContact(payload, { userId, clientId });
    return created?.contact?.contact_id;
  }

  // Private helper methods
  _sanitizeContactPayload(payload) {
    const allowedKeys = new Set([
      "contact_name", "company_name", "email", "phone", "mobile", "contact_type",
      "is_customer", "is_supplier", "customer_sub_type", "billing_address",
      "shipping_address", "website", "currency_code", "notes", "custom_fields",
      "legal_name", "payment_terms", "payment_terms_label", "pan_no", "gst_no",
      "gst_treatment", "tax_reg_no", "contact_persons", "first_name", "last_name",
      "designation", "department", "contact_salutation", "twitter", "facebook",
      "credit_limit", "portal_status", "is_portal_enabled", "currency_id",
      "price_precision", "opening_balance_amount", "tds_tax_id", "trader_name",
      "udyam_reg_no", "msme_type", "sales_channel"
    ]);

    const sanitized = {};
    const removed = [];

    for (const [k, v] of Object.entries(payload || {})) {
      if (allowedKeys.has(k)) {
        sanitized[k] = v;
      } else {
        removed.push(k);
      }
    }

    // Remove problematic fields
    delete sanitized.is_sms_enabled;

    // Sanitize contact persons
    if (Array.isArray(sanitized.contact_persons)) {
      const cpAllowed = new Set([
        "salutation", "first_name", "last_name", "email", "phone", "mobile",
        "designation", "department", "is_primary_contact", "enable_portal"
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
      console.log("ZohoBooks: stripped unsupported keys:", removed);
    }

    return sanitized;
  }

  _buildContactPayload(clientDoc) {
    const contactPerson = clientDoc?.contactPerson || undefined;

    return {
      contact_name: clientDoc?.companyName || clientDoc?.contactPerson || "Unknown",
      company_name: clientDoc?.companyName || clientDoc?.contactPerson || "Unknown",
      email: clientDoc?.email,
      phone: clientDoc?.phone,
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
  }
}

// Create singleton instance
const loggedZohoBooks = new LoggedZohoBooks();

/**
 * Shared helper: push a local Invoice document to Zoho Books and persist the zoho_invoice_id.
 *
 * @param {Object} invoiceDoc  - Saved Mongoose Invoice document
 * @param {Object} clientDoc   - Mongoose Client document with zohoBooksContactId
 * @param {Object} [opts]      - Optional { userId }
 * @returns {Promise<Object|null>} Zoho invoice object or null on failure
 */
export async function pushInvoiceToZoho(invoiceDoc, clientDoc, opts = {}) {
  if (!invoiceDoc || !clientDoc) return null;
  if (invoiceDoc.zoho_invoice_id) return null; // already synced

  const isBlocking = opts.blocking === true;

  if (!clientDoc.zohoBooksContactId) {
    if (isBlocking) {
      // In blocking mode, we try to create the contact first if missing
      try {
        const { findOrCreateContactFromClient: findOrCreate } = await import('./zohoBooks.js');
        clientDoc.zohoBooksContactId = await findOrCreate(clientDoc);
        if (clientDoc.save) await clientDoc.save();
      } catch (contactErr) {
        console.error('[ZohoInvoice] Failed to create contact for blocking push:', contactErr.message);
        throw new Error(`Zoho Contact creation failed: ${contactErr.message}`);
      }
    } else {
      console.warn('[ZohoInvoice] Client has no zohoBooksContactId — skipping Zoho push for invoice', String(invoiceDoc._id));
      return null;
    }
  }

  try {
    const invObj = invoiceDoc.toObject();
    
    // Fetch building to get place_of_supply for organization_state_code
    if (invObj.building) {
      const buildingId = invObj.building?._id || invObj.building;
      const { default: Building } = await import('../models/buildingModel.js');
      const buildingDoc = await Building.findById(buildingId);
      if (buildingDoc) {
        if (!invObj.organization_state_code) {
          invObj.organization_state_code = buildingDoc.place_of_supply || process.env.ZOHO_ORG_STATE_CODE || 'HR';
        }
        if (buildingDoc.zoho_books_location_id && !invObj.zoho_books_location_id) {
          invObj.zoho_books_location_id = buildingDoc.zoho_books_location_id;
        }
      }
    }

    // Leverage the robust GST and tax calculation logic already built in zohoBooks.js
    const zohoInvoice = await createZohoInvoiceFromLocal(invObj, clientDoc);
    const { createZohoInvoiceFromLocal } = await import('./zohoBooks.js'); // Ensure it's available if needed, but it's already imported at top

    if (zohoInvoice?.invoice?.invoice_id) {
      invoiceDoc.zoho_invoice_id = zohoInvoice.invoice.invoice_id;
      invoiceDoc.zoho_invoice_number = zohoInvoice.invoice.invoice_number;
      invoiceDoc.source = 'zoho';
      await invoiceDoc.save();
    }

    return zohoInvoice || null;
  } catch (err) {
    console.error('[ZohoInvoice] Failed to push invoice to Zoho:', err?.message || err);
    if (isBlocking) {
      throw err; // Propagate error for blocking calls
    }
    return null;
  }
}

export default loggedZohoBooks;
