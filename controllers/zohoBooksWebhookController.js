import crypto from "crypto";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import Payment from "../models/paymentModel.js";
import CreditCustomItem from "../models/creditCustomItemModel.js";
import { sendWelcomeEmail } from "../utils/emailService.js";
import { generateLocalInvoiceNumber } from "../utils/invoiceNumberGenerator.js";
import apiLogger from "../utils/apiLogger.js";

// Handle Zoho Books customer creation webhook
export const handleZohoBooksWebhook = async (req, res) => {
  const requestId = await apiLogger.logIncomingWebhook({
    service: 'zoho_books',
    operation: 'webhook',
    method: req.method || 'POST',
    url: req.originalUrl || req.url || '/api/webhooks/zoho-books',
    headers: req.headers || {},
    requestBody: req.body,
    webhookSignature: req.headers['x-zoho-webhook-signature'] || req.headers['x-zoho-signature'] || null,
    webhookVerified: false, // Will be updated after verification
    webhookEvent: 'zoho_books_webhook',
    statusCode: 200,
    responseBody: { received: true },
    success: true,
    userAgent: req.headers['user-agent'] || null,
    ipAddress: (req.headers['x-forwarded-for'] || req.ip || '').toString()
  });

  try {
    console.log("Zoho Books webhook received:", {
      requestId,
      headers: req.headers,
      body: req.body,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length']
    });

    // Handle webhook verification/test requests (empty body)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength === 0 || !req.body || Object.keys(req.body).length === 0) {
      console.log("Received webhook verification/test request with empty body");
      const response = {
        received: true,
        message: "Webhook endpoint is active",
        service: "ofis-square",
        timestamp: new Date().toISOString()
      };
      await apiLogger.logWebhookResponse(requestId, 200, response, true);
      return res.status(200).json(response);
    }

    let payload = req.body;
    if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      if (req.body?.payload) {
        try {
          payload = JSON.parse(req.body.payload);
          console.log("Parsed form-urlencoded payload");
        } catch (e) {
          console.error("Failed to parse form-urlencoded payload:", e);
          return res.status(400).json({ 
            error: "Invalid form-urlencoded payload",
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Basic webhook security - check for Zoho user agent and organization ID
    const userAgent = req.headers['user-agent'];
    const orgId = req.headers['x-com-zoho-organizationid'];
    const expectedOrgId = process.env.ZOHO_ORG_ID || '60047183737';
    const zohoFeature = req.headers['x-zoho-crm-feature'];
    
    // Accept webhooks from both Zoho Books and Zoho CRM
    const isZohoBooks = userAgent?.includes('ZohoBooks');
    const isZohoCRM = userAgent?.includes('crm.zoho') || zohoFeature === 'webhook';
    
    if (!isZohoBooks && !isZohoCRM) {
      console.warn("Webhook received from non-Zoho user agent:", userAgent);
      // Don't reject - log and continue for debugging
    } else {
      console.log(`Webhook source identified: ${isZohoBooks ? 'Zoho Books' : 'Zoho CRM'}`);
    }
    
    if (orgId && orgId !== expectedOrgId) {
      console.error("Webhook from unauthorized organization:", orgId);
      return res.status(403).json({ 
        error: "Unauthorized organization",
        timestamp: new Date().toISOString()
      });
    }

    // Verify webhook signature if secret is configured
    const secret = process.env.ZOHO_BOOKS_WEBHOOK_SECRET;
    const sigHeader = req.headers["x-zoho-webhook-signature"] || 
                     req.headers["x-zoho-signature"] || 
                     req.headers["zoho-webhook-signature"];
    
    let rawBodyStr = "";
    if (Buffer.isBuffer(req.body)) {
      rawBodyStr = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      rawBodyStr = req.body;
    } else {
      rawBodyStr = JSON.stringify(req.body || {});
    }

    if (secret && sigHeader) {
      try {
        const hmac = crypto.createHmac("sha256", secret).update(rawBodyStr).digest("hex");
        const expectedSignature = `sha256=${hmac}`;
        
        if (sigHeader !== hmac && sigHeader !== expectedSignature) {
          console.error("Zoho Books webhook signature verification failed:", {
            received: sigHeader,
            expected: hmac,
            expectedWithPrefix: expectedSignature
          });
          return res.status(401).json({ 
            error: "Invalid webhook signature",
            timestamp: new Date().toISOString()
          });
        }
        console.log("Zoho Books webhook signature verified successfully");
      } catch (e) {
        console.error("Zoho Books webhook signature verification error:", e);
        return res.status(401).json({ 
          error: "Webhook signature verification failed",
          timestamp: new Date().toISOString()
        });
      }
    } else if (secret) {
      console.warn("Zoho Books webhook secret configured but no signature header found");
    }

    // Process the webhook event
    const result = await processZohoBooksEvent(payload);
    
    const response = {
      message: "Zoho Books webhook processed successfully",
      result,
      timestamp: new Date().toISOString()
    };

    await apiLogger.logWebhookResponse(requestId, 200, response, true);
    
    return res.status(200).json(response);

  } catch (err) {
    console.error("Zoho Books webhook error:", err);
    
    const errorResponse = { 
      error: "Webhook processing failed",
      message: err.message,
      timestamp: new Date().toISOString()
    };

    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, err.message);
    
    return res.status(500).json(errorResponse);
  }
};

async function processZohoBooksEvent(payload) {
  const eventType = payload?.event_type || payload?.eventType;
  const data = payload?.data || payload;

  console.log("Processing Zoho Books event:", {
    event_type: eventType,
    data_keys: Object.keys(data || {}),
    has_contact: !!payload?.contact,
    has_customer: !!payload?.customer,
    has_invoice: !!payload?.invoice,
    has_payment: !!payload?.payment,
    has_item: !!payload?.item
  });

  // Handle customer creation events with explicit event type
  if (eventType === "customer_created" || eventType === "CustomerCreated") {
    return await handleCustomerCreated(data);
  }

  // Handle customer update events with explicit event type
  if (eventType === "customer_updated" || eventType === "CustomerUpdated") {
    return await handleCustomerUpdated(data);
  }

  // Handle direct customer payload (Zoho Books sends customer data directly without event_type)
  if (payload?.customer && !eventType) {
    console.log("Detected direct customer payload from Zoho Books webhook");
    
    // Check if this is a new customer by looking at created_time vs last_modified_time
    const customer = payload.customer;
    const createdTime = new Date(customer.created_time);
    const modifiedTime = new Date(customer.last_modified_time);
    
    // If created and modified times are very close (within 5 seconds), treat as creation
    const timeDiff = Math.abs(modifiedTime.getTime() - createdTime.getTime());
    const isNewCustomer = timeDiff < 5000; // 5 seconds threshold
    
    if (isNewCustomer) {
      console.log("Processing as customer creation event");
      return await handleCustomerCreated({ customer });
    } else {
      console.log("Processing as customer update event");
      return await handleCustomerUpdated({ customer });
    }
  }

  if (payload?.invoice && !eventType) {
    console.log("Detected invoice payload from Zoho Books webhook");
    return await handleInvoiceEvent(payload.invoice);
  }
  if (eventType === "invoice_created" || eventType === "InvoiceCreated" || 
      eventType === "invoice_updated" || eventType === "InvoiceUpdated") {
    return await handleInvoiceEvent(data.invoice || data);
  }
  if (payload?.payment && !eventType) {
    console.log("Detected payment payload from Zoho Books webhook");
    return await handlePaymentReceived(payload.payment);
  }
  if (eventType === "payment_created" || eventType === "PaymentCreated" ||
      eventType === "payment_updated" || eventType === "PaymentUpdated" ||
      eventType === "customerpayment_created" || eventType === "CustomerPaymentCreated" ||
      eventType === "customerpayment_updated" || eventType === "CustomerPaymentUpdated") {
    return await handlePaymentReceived(data.payment || data);
  }

  // Handle item events (for credit custom items sync)
  if (payload?.item && !eventType) {
    console.log("Detected item payload from Zoho Books webhook");
    
    const item = payload.item;
    const createdTime = new Date(item.created_time);
    const modifiedTime = new Date(item.last_modified_time);
    
    const timeDiff = Math.abs(modifiedTime.getTime() - createdTime.getTime());
    const isNewItem = timeDiff < 5000;
    
    if (isNewItem) {
      console.log("Processing item as creation event");
      return await handleItemCreated({ item });
    } else {
      console.log("Processing item as update event");
      return await handleItemUpdated({ item });
    }
  }

  // Handle item events with explicit event type
  if (eventType === "item_created" || eventType === "ItemCreated") {
    return await handleItemCreated(data);
  }

  if (eventType === "item_updated" || eventType === "ItemUpdated") {
    return await handleItemUpdated(data);
  }

  if (payload?.contact && !eventType) {
    console.log("Detected legacy contact payload from Zoho Books webhook");
    
    const contact = payload.contact;
    const createdTime = new Date(contact.created_time);
    const modifiedTime = new Date(contact.last_modified_time);
    
    const timeDiff = Math.abs(modifiedTime.getTime() - createdTime.getTime());
    const isNewContact = timeDiff < 5000;
    
    if (isNewContact) {
      console.log("Processing legacy contact as creation event");
      return await handleContactCreated({ contact });
    } else {
      console.log("Processing legacy contact as update event");
      return await handleContactUpdated({ contact });
    }
  }

  console.log(`Unhandled Zoho Books event type: ${eventType}`);
  return { 
    status: "ignored", 
    reason: "Unhandled event type or missing customer/contact/invoice/payment/item data",
    event_type: eventType,
    has_contact: !!payload?.contact,
    has_customer: !!payload?.customer,
    has_invoice: !!payload?.invoice,
    has_payment: !!payload?.payment,
    has_item: !!payload?.item
  };
}

// Handle customer creation (primary function for Zoho Books)
async function handleCustomerCreated(customerData) {
  try {
    const customer = customerData?.customer || customerData;
    
    if (!customer) {
      console.warn("No customer data found in webhook payload");
      return { status: "ignored", reason: "No customer data" };
    }

    const customerId = customer.customer_id;
    const email = customer.email;
    const companyName = customer.company_name || customer.customer_name;

    console.log(`Processing customer creation for: ${companyName} (${email}) - Zoho ID: ${customerId}`);

    // Check if client already exists with this Zoho customer ID
    const existingClient = await Client.findOne({ zohoBooksContactId: customerId });
    if (existingClient) {
      console.log(`Client already exists for Zoho customer ID: ${customerId}`);
      return { 
        status: "ignored", 
        reason: "Client already exists",
        client_id: existingClient._id 
      };
    }

    // Check if client exists by email
    if (email) {
      const existingByEmail = await Client.findOne({ email: email.toLowerCase() });
      if (existingByEmail) {
        // Update existing client with Zoho customer ID
        existingByEmail.zohoBooksContactId = customerId;
        await existingByEmail.save();
        console.log(`Updated existing client ${existingByEmail._id} with Zoho customer ID: ${customerId}`);
        return { 
          status: "updated", 
          reason: "Added Zoho ID to existing client",
          client_id: existingByEmail._id 
        };
      }
    }

    // Create new client from Zoho customer data
    const clientData = await mapZohoCustomerToClient(customer);
    const newClient = await Client.create(clientData);

    console.log(`Created new client ${newClient._id} from Zoho customer ${customerId}`);

    // Create user and member records if email OR phone are available (not both required)
    let createdUserId = null;
    if (newClient.email || newClient.phone) {
      try {
        createdUserId = await createUserAndMemberForClient(newClient);
      } catch (userErr) {
        console.error("Failed to create user/member for Zoho-created client:", userErr);
      }
    }

    // Send welcome email
    if (newClient.email) {
      try {
        const emailResult = await sendWelcomeEmail({
          companyName: newClient.companyName,
          contactPerson: newClient.contactPerson,
          email: newClient.email
        });
        
        if (emailResult.success) {
          console.log(`Welcome email sent to ${newClient.email} for Zoho-created client`);
        } else {
          console.error(`Failed to send welcome email:`, emailResult.error);
        }
      } catch (emailErr) {
        console.error("Welcome email error for Zoho-created client:", emailErr);
      }
    }

    return {
      status: "created",
      client_id: newClient._id,
      zoho_customer_id: customerId,
      user_created: !!createdUserId,
      user_id: createdUserId
    };

  } catch (err) {
    console.error("Error handling Zoho customer creation:", err);
    throw err;
  }
}

async function handleCustomerUpdated(customerData) {
  try {
    const customer = customerData?.customer || customerData;
    const customerId = customer?.customer_id;

    if (!customerId) {
      return { status: "ignored", reason: "No customer ID" };
    }

    // Find existing client by Zoho customer ID
    const existingClient = await Client.findOne({ zohoBooksContactId: customerId });
    if (!existingClient) {
      console.log(`No client found for updated Zoho customer ID: ${customerId}`);
      return { status: "ignored", reason: "Client not found" };
    }

    // Update client with new data from Zoho
    const updatedData = await mapZohoCustomerToClient(customer);
    
    // Remove fields that shouldn't be overwritten
    delete updatedData.zohoBooksContactId; // Keep existing
    delete updatedData.kycStatus; // Don't reset KYC status
    delete updatedData.building; // Don't change building assignment

    await Client.findByIdAndUpdate(existingClient._id, { $set: updatedData });

    console.log(`Updated client ${existingClient._id} from Zoho customer update`);

    return {
      status: "updated",
      client_id: existingClient._id,
      zoho_customer_id: customerId
    };

  } catch (err) {
    console.error("Error handling Zoho customer update:", err);
    throw err;
  }
}

// Legacy contact handlers (for backward compatibility)
async function handleContactCreated(contactData) {
  try {
    const contact = contactData?.contact || contactData;
    
    if (!contact) {
      console.warn("No contact data found in webhook payload");
      return { status: "ignored", reason: "No contact data" };
    }

    const contactId = contact.contact_id;
    const email = contact.email;
    const companyName = contact.company_name || contact.contact_name;

    console.log(`Processing contact creation for: ${companyName} (${email}) - Zoho ID: ${contactId}`);

    // Check if client already exists with this Zoho contact ID
    const existingClient = await Client.findOne({ zohoBooksContactId: contactId });
    if (existingClient) {
      console.log(`Client already exists for Zoho contact ID: ${contactId}`);
      return { 
        status: "ignored", 
        reason: "Client already exists",
        client_id: existingClient._id 
      };
    }

    // Check if client exists by email
    if (email) {
      const existingByEmail = await Client.findOne({ email: email.toLowerCase() });
      if (existingByEmail) {
        // Update existing client with Zoho contact ID
        existingByEmail.zohoBooksContactId = contactId;
        await existingByEmail.save();
        console.log(`Updated existing client ${existingByEmail._id} with Zoho contact ID: ${contactId}`);
        return { 
          status: "updated", 
          reason: "Added Zoho ID to existing client",
          client_id: existingByEmail._id 
        };
      }
    }

    // Create new client from Zoho contact data
    const clientData = await mapZohoContactToClient(contact);
    const newClient = await Client.create(clientData);

    console.log(`Created new client ${newClient._id} from Zoho contact ${contactId}`);

    // Create user and member records if email OR phone are available (not both required)
    let createdUserId = null;
    if (newClient.email || newClient.phone) {
      try {
        createdUserId = await createUserAndMemberForClient(newClient);
      } catch (userErr) {
        console.error("Failed to create user/member for Zoho-created client:", userErr);
      }
    }

    // Send welcome email
    if (newClient.email) {
      try {
        const emailResult = await sendWelcomeEmail({
          companyName: newClient.companyName,
          contactPerson: newClient.contactPerson,
          email: newClient.email
        });
        
        if (emailResult.success) {
          console.log(`Welcome email sent to ${newClient.email} for Zoho-created client`);
        } else {
          console.error(`Failed to send welcome email:`, emailResult.error);
        }
      } catch (emailErr) {
        console.error("Welcome email error for Zoho-created client:", emailErr);
      }
    }

    return {
      status: "created",
      client_id: newClient._id,
      zoho_contact_id: contactId,
      user_created: !!createdUserId,
      user_id: createdUserId
    };

  } catch (err) {
    console.error("Error handling Zoho contact creation:", err);
    throw err;
  }
}

async function handleContactUpdated(contactData) {
  try {
    const contact = contactData?.contact || contactData;
    const contactId = contact?.contact_id;

    if (!contactId) {
      return { status: "ignored", reason: "No contact ID" };
    }

    // Find existing client by Zoho contact ID
    const existingClient = await Client.findOne({ zohoBooksContactId: contactId });
    if (!existingClient) {
      console.log(`No client found for updated Zoho contact ID: ${contactId}`);
      return { status: "ignored", reason: "Client not found" };
    }

    // Update client with new data from Zoho
    const updatedData = await mapZohoContactToClient(contact);
    
    // Remove fields that shouldn't be overwritten
    delete updatedData.zohoBooksContactId; // Keep existing
    delete updatedData.kycStatus; // Don't reset KYC status
    delete updatedData.building; // Don't change building assignment

    await Client.findByIdAndUpdate(existingClient._id, { $set: updatedData });

    console.log(`Updated client ${existingClient._id} from Zoho contact update`);

    return {
      status: "updated",
      client_id: existingClient._id,
      zoho_contact_id: contactId
    };

  } catch (err) {
    console.error("Error handling Zoho contact update:", err);
    throw err;
  }
}

// Handle item creation from Zoho Books webhook
async function handleItemCreated(itemData) {
  try {
    const item = itemData?.item || itemData;
    
    if (!item) {
      console.warn("No item data found in webhook payload");
      return { status: "ignored", reason: "No item data" };
    }

    const itemId = item.item_id;
    const itemName = item.name;
    const itemRate = parseFloat(item.rate || item.sales_rate || 0);

    console.log(`Processing item creation for: ${itemName} - Zoho ID: ${itemId}, Rate: ${itemRate}`);

    // Check if credit custom item already exists with this Zoho item ID
    const existingItem = await CreditCustomItem.findOne({ zohoItemId: itemId });
    if (existingItem) {
      console.log(`Credit custom item already exists for Zoho item ID: ${itemId}`);
      return { 
        status: "ignored", 
        reason: "Credit custom item already exists",
        item_id: existingItem._id 
      };
    }

    // Check if item exists by name
    const existingByName = await CreditCustomItem.findOne({ 
      name: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (existingByName) {
      // Update existing item with Zoho item ID
      existingByName.zohoItemId = itemId;
      await existingByName.save();
      console.log(`Updated existing credit custom item ${existingByName._id} with Zoho item ID: ${itemId}`);
      return { 
        status: "updated", 
        reason: "Added Zoho ID to existing item",
        item_id: existingByName._id 
      };
    }

    // Create new credit custom item from Zoho item data
    const itemDataToCreate = await mapZohoItemToCreditCustomItem(item);
    const newItem = await CreditCustomItem.create(itemDataToCreate);

    console.log(`Created new credit custom item ${newItem._id} from Zoho item ${itemId}`);

    return {
      status: "created",
      item_id: newItem._id,
      zoho_item_id: itemId,
      name: itemName,
      rate: itemRate
    };

  } catch (err) {
    console.error("Error handling Zoho item creation:", err);
    throw err;
  }
}

// Handle item update from Zoho Books webhook
async function handleItemUpdated(itemData) {
  try {
    const item = itemData?.item || itemData;
    const itemId = item?.item_id;

    if (!itemId) {
      return { status: "ignored", reason: "No item ID" };
    }

    // Find existing credit custom item by Zoho item ID
    const existingItem = await CreditCustomItem.findOne({ zohoItemId: itemId });
    if (!existingItem) {
      console.log(`No credit custom item found for updated Zoho item ID: ${itemId}`);
      return { status: "ignored", reason: "Credit custom item not found" };
    }

    // Update item with new data from Zoho
    const updatedData = await mapZohoItemToCreditCustomItem(item);
    
    // Remove fields that shouldn't be overwritten
    delete updatedData.zohoItemId; // Keep existing
    delete updatedData.code; // Don't change existing code
    delete updatedData.tags; // Don't change existing tags
    delete updatedData.metadata; // Don't change existing metadata

    await CreditCustomItem.findByIdAndUpdate(existingItem._id, { $set: updatedData });

    console.log(`Updated credit custom item ${existingItem._id} from Zoho item update`);

    return {
      status: "updated",
      item_id: existingItem._id,
      zoho_item_id: itemId,
      name: item.name
    };

  } catch (err) {
    console.error("Error handling Zoho item update:", err);
    throw err;
  }
}

// Map Zoho item fields to credit custom item model
async function mapZohoItemToCreditCustomItem(item) {
  const itemRate = parseFloat(item.rate || item.sales_rate || 0);
  const creditValue = 500; // Default credit value in INR
  
  const itemData = {
    name: item.name || "Unknown Item",
    code: item.sku || undefined,
    unit: item.unit || "unit",
    pricingMode: "inr", // Always use INR mode as requested
    
    // Set INR price (required for INR mode)
    unitPriceINR: itemRate,
    
    // Optionally set equivalent credits for reference (not required for INR mode)
    ...(itemRate > 0 && { 
      metadata: {
        equivalentCredits: Math.ceil(itemRate / creditValue),
        zoho_created_time: item.created_time,
        zoho_last_modified_time: item.last_modified_time,
        zoho_item_type: item.item_type,
        zoho_product_type: item.product_type,
        zoho_account_id: item.account_id,
        zoho_account_name: item.account_name,
        zoho_purchase_account_id: item.purchase_account_id,
        zoho_purchase_account_name: item.purchase_account_name,
        zoho_description: item.description,
        zoho_purchase_description: item.purchase_description
      }
    }),
    
    // Tax settings
    taxable: item.tax_percentage > 0 || item.is_default_tax_applied || true,
    gstRate: parseFloat(item.tax_percentage || 18),
    
    // Status
    active: item.status === "active",
    
    // Zoho linkage
    zohoItemId: item.item_id
  };

  // Remove undefined fields
  Object.keys(itemData).forEach(key => {
    if (itemData[key] === undefined) {
      delete itemData[key];
    }
  });

  return itemData;
}

// Map Zoho customer fields to client model (primary mapping function)
async function mapZohoCustomerToClient(customer) {
  // Map Zoho customer fields to client model
  const clientData = {
    companyName: customer.company_name || customer.customer_name || "Unknown Company",
    legalName: customer.legal_name || customer.company_name,
    contactPerson: customer.customer_name || (customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : undefined) || "Unknown",
    email: customer.email && customer.email.trim() ? customer.email.toLowerCase().trim() : undefined,
    phone: customer.phone && customer.phone.trim() ? customer.phone.trim() : (customer.mobile && customer.mobile.trim() ? customer.mobile.trim() : undefined),
    website: customer.website && customer.website.trim() ? customer.website.trim() : undefined,
    
    // Commercial details
    contactType: customer.contact_type || "customer",
    customerSubType: customer.customer_sub_type || "business",
    creditLimit: customer.credit_limit || undefined,
    isPortalEnabled: customer.is_portal_enabled || false,
    paymentTerms: customer.payment_terms || undefined,
    paymentTermsLabel: customer.payment_terms_label || undefined,
    notes: customer.notes || undefined,

    // Tax details
    gstNo: customer.gst_no || undefined,
    gstTreatment: customer.gst_treatment || undefined,
    isTaxable: customer.is_taxable !== false, // Default to true
    taxRegNo: customer.tax_reg_no || undefined,

    // Address details
    billingAddress: customer.billing_address ? {
      attention: customer.billing_address.attention || undefined,
      address: customer.billing_address.address || undefined,
      street2: customer.billing_address.street2 || undefined,
      city: customer.billing_address.city || undefined,
      state: customer.billing_address.state || undefined,
      zip: customer.billing_address.zip || undefined,
      country: customer.billing_address.country || undefined,
      phone: customer.billing_address.phone || undefined
    } : undefined,

    shippingAddress: customer.shipping_address ? {
      attention: customer.shipping_address.attention || undefined,
      address: customer.shipping_address.address || undefined,
      street2: customer.shipping_address.street2 || undefined,
      city: customer.shipping_address.city || undefined,
      state: customer.shipping_address.state || undefined,
      zip: customer.shipping_address.zip || undefined,
      country: customer.shipping_address.country || undefined,
      phone: customer.shipping_address.phone || undefined
    } : undefined,

    // Contact persons (if available)
    contactPersons: Array.isArray(customer.contact_persons) ? 
      customer.contact_persons.map(cp => ({
        salutation: cp.salutation || undefined,
        first_name: cp.first_name || undefined,
        last_name: cp.last_name || undefined,
        email: cp.email ? cp.email.toLowerCase().trim() : undefined,
        phone: cp.phone || undefined,
        mobile: cp.mobile || undefined,
        designation: cp.designation || undefined,
        department: cp.department || undefined,
        is_primary_contact: cp.is_primary_contact || false,
        enable_portal: cp.enable_portal || false
      })) : [],

    // Zoho linkage
    zohoBooksContactId: customer.customer_id,
    currencyId: customer.currency_id || undefined,
    pricebookId: customer.pricebook_id || undefined,

    // Status
    companyDetailsComplete: true,
    kycStatus: "pending"
  };

  // Remove undefined fields
  Object.keys(clientData).forEach(key => {
    if (clientData[key] === undefined) {
      delete clientData[key];
    }
  });

  return clientData;
}

// Legacy contact mapping function (for backward compatibility)
async function mapZohoContactToClient(contact) {
  // Map Zoho contact fields to client model
  const clientData = {
    companyName: contact.company_name || contact.contact_name || "Unknown Company",
    legalName: contact.legal_name || contact.company_name,
    contactPerson: contact.contact_name || (contact.first_name && contact.last_name ? `${contact.first_name} ${contact.last_name}` : undefined) || "Unknown",
    email: contact.email && contact.email.trim() ? contact.email.toLowerCase().trim() : undefined,
    phone: contact.phone && contact.phone.trim() ? contact.phone.trim() : (contact.mobile && contact.mobile.trim() ? contact.mobile.trim() : undefined),
    website: contact.website && contact.website.trim() ? contact.website.trim() : undefined,
    
    // Commercial details
    contactType: contact.contact_type || "customer",
    customerSubType: contact.customer_sub_type || "business",
    creditLimit: contact.credit_limit || undefined,
    isPortalEnabled: contact.is_portal_enabled || false,
    paymentTerms: contact.payment_terms || undefined,
    paymentTermsLabel: contact.payment_terms_label || undefined,
    notes: contact.notes || undefined,

    // Tax details
    gstNo: contact.gst_no || undefined,
    gstTreatment: contact.gst_treatment || undefined,
    isTaxable: contact.is_taxable !== false, // Default to true
    taxRegNo: contact.tax_reg_no || undefined,

    // Address details
    billingAddress: contact.billing_address ? {
      attention: contact.billing_address.attention || undefined,
      address: contact.billing_address.address || undefined,
      street2: contact.billing_address.street2 || undefined,
      city: contact.billing_address.city || undefined,
      state: contact.billing_address.state || undefined,
      zip: contact.billing_address.zip || undefined,
      country: contact.billing_address.country || undefined,
      phone: contact.billing_address.phone || undefined
    } : undefined,

    shippingAddress: contact.shipping_address ? {
      attention: contact.shipping_address.attention || undefined,
      address: contact.shipping_address.address || undefined,
      street2: contact.shipping_address.street2 || undefined,
      city: contact.shipping_address.city || undefined,
      state: contact.shipping_address.state || undefined,
      zip: contact.shipping_address.zip || undefined,
      country: contact.shipping_address.country || undefined,
      phone: contact.shipping_address.phone || undefined
    } : undefined,

    // Contact persons
    contactPersons: Array.isArray(contact.contact_persons) ? 
      contact.contact_persons.map(cp => ({
        salutation: cp.salutation || undefined,
        first_name: cp.first_name || undefined,
        last_name: cp.last_name || undefined,
        email: cp.email ? cp.email.toLowerCase().trim() : undefined,
        phone: cp.phone || undefined,
        mobile: cp.mobile || undefined,
        designation: cp.designation || undefined,
        department: cp.department || undefined,
        is_primary_contact: cp.is_primary_contact || false,
        enable_portal: cp.enable_portal || false
      })) : [],

    // Zoho linkage
    zohoBooksContactId: contact.contact_id,
    currencyId: contact.currency_id || undefined,
    pricebookId: contact.pricebook_id || undefined,

    // Status
    companyDetailsComplete: true,
    kycStatus: "pending"
  };

  // Remove undefined fields
  Object.keys(clientData).forEach(key => {
    if (clientData[key] === undefined) {
      delete clientData[key];
    }
  });

  return clientData;
}

async function createUserAndMemberForClient(client) {
  try {
    // Find or create 'client' role
    let roleClient = await Role.findOne({ roleName: { $regex: /^client$/i } });
    if (!roleClient) {
      roleClient = await Role.create({ roleName: "client", permissions: [] });
    }

    // Check if user already exists
    let user = await User.findOne({
      $or: [
        { email: client.email },
        { phone: client.phone }
      ]
    });

    if (!user) {
      const name = client.contactPerson?.trim() || client.companyName?.trim() || "Client User";
      user = await User.create({
        role: roleClient._id,
        name,
        email: client.email || undefined,
        phone: client.phone || undefined,
        password: '123456' // Default password
      });
    } else if (!user.role) {
      user.role = roleClient._id;
      await user.save();
    }

    // Update client with user reference
    client.ownerUser = user._id;
    await client.save();

    // Create primary Member record
    const existingOwnerMember = await Member.findOne({
      client: client._id,
      user: user._id,
      role: "owner"
    });

    if (!existingOwnerMember) {
      await Member.create({
        firstName: (client.contactPerson || client.companyName || "Owner").trim(),
        lastName: "",
        email: client.email || undefined,
        phone: client.phone || undefined,
        companyName: client.companyName || undefined,
        role: "owner",
        client: client._id,
        user: user._id,
        status: "active"
      });
    }

    return user._id;

  } catch (err) {
    console.error("Error creating user/member for Zoho client:", err);
    throw err;
  }
}

// Health check endpoint for Zoho Books webhook
export const zohoBooksWebhookHealthCheck = async (req, res) => {
  return res.status(200).json({
    status: "healthy",
    service: "Zoho Books Webhook Handler",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
};

// Test endpoint for Zoho Books webhook (development only)
export const testZohoBooksWebhook = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const { testType = "customer" } = req.query;

  let testPayload;

  if (testType === "payment") {
    testPayload = {
      event_type: "customerpayment_created",
      data: {
        payment: {
          payment_id: "test_payment_123",
          payment_number: "PMT-000001",
          customer_id: "test_customer_123",
          amount: 1000.00,
          date: new Date().toISOString().split('T')[0],
          payment_mode: "bank_transfer",
          reference_number: "REF123456",
          description: "Test payment via webhook",
          status: "success",
          currency_code: "INR",
          account_id: "test_account_123",
          invoices: [
            {
              invoice_id: "test_invoice_123",
              amount_applied: 1000.00
            }
          ],
          created_time: new Date().toISOString(),
          last_modified_time: new Date().toISOString()
        }
      },
      timestamp: new Date().toISOString()
    };
  } else {
    testPayload = {
      event_type: "customer_created",
      data: {
        customer: {
          customer_id: "test_customer_123",
          customer_name: "Test Company",
          company_name: "Test Company Ltd", 
          email: "test@testcompany.com",
          phone: "1234567890",
          mobile: "1234567890",
          contact_type: "customer",
          customer_sub_type: "business",
          created_time: new Date().toISOString(),
          last_modified_time: new Date().toISOString(),
          status: "active",
          currency_code: "INR",
          billing_address: {
            attention: "Test Person",
            address: "123 Test Street",
            city: "Test City",
            state: "Test State",
            zip: "12345",
            country: "India"
          },
          shipping_address: {
            attention: "Test Person",
            address: "123 Test Street", 
            city: "Test City",
            state: "Test State",
            zip: "12345",
            country: "India"
          }
        }
      },
      timestamp: new Date().toISOString()
    };
  }

  try {
    const result = await processZohoBooksEvent(testPayload);
    return res.status(200).json({
      message: `Test Zoho Books ${testType} webhook processed`,
      test_payload: testPayload,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: "Test webhook failed",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Handle invoice creation/update from Zoho Books webhook
async function handleInvoiceEvent(invoiceData) {
  try {
    console.log("Processing invoice event:", {
      invoice_id: invoiceData.invoice_id,
      invoice_number: invoiceData.invoice_number,
      customer_id: invoiceData.customer_id,
      status: invoiceData.status,
      total: invoiceData.total,
      created_time: invoiceData.created_time,
      last_modified_time: invoiceData.last_modified_time
    });

    // Find the client by Zoho Books contact ID
    let client = null;
    if (invoiceData.customer_id) {
      client = await Client.findOne({ zohoBooksContactId: invoiceData.customer_id });
      if (!client) {
        console.warn(`No client found with zohoBooksContactId: ${invoiceData.customer_id} for invoice ${invoiceData.invoice_id}`);
      }
    }

    // Check if invoice already exists
    let existingInvoice = await Invoice.findOne({ zoho_invoice_id: invoiceData.invoice_id });
    
    // Check for idempotency - don't update if we have newer data
    if (existingInvoice && existingInvoice.zoho_last_modified_at) {
      const existingModifiedTime = new Date(existingInvoice.zoho_last_modified_at);
      const incomingModifiedTime = new Date(invoiceData.last_modified_time);
      
      if (incomingModifiedTime <= existingModifiedTime) {
        console.log(`Skipping invoice ${invoiceData.invoice_id} - incoming data is not newer`);
        return {
          action: "skipped",
          reason: "not_newer",
          invoice_id: invoiceData.invoice_id
        };
      }
    }

    // Generate our local invoice number for new invoices
    let localInvoiceNumber = null;
    if (!existingInvoice) {
      localInvoiceNumber = await generateLocalInvoiceNumber();
    }

    // Map Zoho invoice data to our schema
    const mappedInvoiceData = {
      // Core invoice fields - use our local number, not Zoho's
      ...(localInvoiceNumber && { invoice_number: localInvoiceNumber }),
      date: invoiceData.date ? new Date(invoiceData.date) : new Date(),
      // Set due date to end of current month instead of using Zoho's due_date
      due_date: (() => {
        const currentDate = new Date();
        return new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0); // Last day of current month
      })(),
      
      // Financial fields
      sub_total: parseFloat(invoiceData.sub_total || 0),
      tax_total: parseFloat(invoiceData.tax_total || 0),
      total: parseFloat(invoiceData.total || 0),
      amount_paid: parseFloat(invoiceData.payment_made || 0),
      balance: parseFloat(invoiceData.balance || 0),
      discount: parseFloat(invoiceData.discount_total || 0),
      discount_type: invoiceData.discount_type || "entity_level",
      
      // Status and metadata
      status: mapZohoStatusToLocal(invoiceData.status),
      notes: invoiceData.notes || "",
      currency_code: invoiceData.currency_code || "INR",
      exchange_rate: parseFloat(invoiceData.exchange_rate || 1),
      
      // Zoho-specific fields
      zoho_invoice_id: invoiceData.invoice_id,
      zoho_invoice_number: invoiceData.invoice_number,
      zoho_status: invoiceData.status,
      invoice_url: invoiceData.invoice_url,
      zoho_pdf_url: invoiceData.pdf_url,
      zoho_last_modified_at: new Date(invoiceData.last_modified_time),
      
      // Set source to indicate this came from Zoho webhook
      source: "webhook",
      
      // Client reference
      client: client ? client._id : null,
      customer_id: invoiceData.customer_id,
      
      // Additional Zoho fields
      gst_treatment: invoiceData.gst_treatment || "business_gst",
      place_of_supply: invoiceData.place_of_supply || "MH",
      payment_terms: parseInt(invoiceData.payment_terms || 30),
      payment_terms_label: invoiceData.payment_terms_label || "Net 30",
      is_inclusive_tax: invoiceData.is_inclusive_tax || false,
      
      // Map line items if present
      line_items: (invoiceData.line_items || []).map(item => ({
        description: item.description || item.name || "",
        name: item.name || item.description || "",
        quantity: parseInt(item.quantity || 1),
        rate: parseFloat(item.rate || 0),
        unitPrice: parseFloat(item.rate || 0),
        amount: parseFloat(item.item_total || 0),
        item_total: parseFloat(item.item_total || 0),
        unit: item.unit || "nos",
        tax_name: item.tax_name || "GST",
        tax_percentage: parseFloat(item.tax_percentage || 0),
        item_id: item.item_id || null
      }))
    };

    let result;
    if (existingInvoice) {
      // Update existing invoice
      await Invoice.findByIdAndUpdate(existingInvoice._id, mappedInvoiceData);
      console.log(`Updated invoice ${invoiceData.invoice_id} in database`);
      result = {
        action: "updated",
        invoice_id: invoiceData.invoice_id,
        local_id: existingInvoice._id
      };
    } else {
      // Create new invoice
      const newInvoice = await Invoice.create(mappedInvoiceData);
      console.log(`Created invoice ${invoiceData.invoice_id} in database with local ID ${newInvoice._id}`);
      result = {
        action: "created",
        invoice_id: invoiceData.invoice_id,
        local_id: newInvoice._id
      };
    }

    // Add client linking info to result
    if (client) {
      result.client_linked = true;
      result.client_id = client._id;
    } else {
      result.client_linked = false;
      result.customer_id = invoiceData.customer_id;
    }

    return result;

  } catch (error) {
    console.error("Error processing invoice webhook:", error);
    throw error;
  }
}

// Map Zoho invoice status to our local status values
function mapZohoStatusToLocal(zohoStatus) {
  const statusMap = {
    'draft': 'draft',
    'sent': 'issued',
    'viewed': 'issued',
    'paid': 'paid',
    'overdue': 'overdue',
    'void': 'void',
    'partially_paid': 'issued'
  };
  
  return statusMap[zohoStatus?.toLowerCase()] || 'draft';
}

async function handleInvoiceStatusUpdate(invoiceData) {
  try {
    if (!invoiceData || !invoiceData.invoice_id) {
      console.warn("No invoice data or invoice_id found in webhook payload");
      return { status: "ignored", reason: "No invoice data" };
    }

    const zohoInvoiceId = invoiceData.invoice_id;
    console.log(`Processing invoice status update for Zoho invoice: ${zohoInvoiceId}`);
    const existingInvoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
    
    if (!existingInvoice) {
      console.log(`Invoice ${zohoInvoiceId} not found locally - likely created directly in Zoho Books. Skipping update.`);
      return {
        status: "ignored", 
        reason: "Invoice not found locally",
        invoice_id: zohoInvoiceId
      };
    }

    const updates = {};
    if (invoiceData.payment_made !== undefined) {
      updates.amount_paid = parseFloat(invoiceData.payment_made || 0);
    }
    
    if (invoiceData.balance !== undefined) {
      updates.balance = parseFloat(invoiceData.balance || 0);
    }
    
    // Update status if changed
    if (invoiceData.status) {
      updates.status = mapZohoStatusToLocal(invoiceData.status);
      updates.zoho_status = invoiceData.status;
    }
    
    // Update URLs if available
    if (invoiceData.invoice_url) {
      updates.invoice_url = invoiceData.invoice_url;
    }
    
    if (invoiceData.pdf_url) {
      updates.zoho_pdf_url = invoiceData.pdf_url;
    }
    
    // Update last modified time
    if (invoiceData.last_modified_time) {
      updates.zoho_last_modified_at = new Date(invoiceData.last_modified_time);
    }
    
    // Set paid date if fully paid
    if (updates.balance === 0 && existingInvoice.balance > 0) {
      updates.paid_at = new Date();
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await Invoice.findByIdAndUpdate(existingInvoice._id, updates);
      console.log(`Updated invoice ${zohoInvoiceId} with status/payment changes`);
      
      return {
        status: "updated",
        invoice_id: zohoInvoiceId,
        local_id: existingInvoice._id,
        updates: Object.keys(updates)
      };
    } else {
      console.log(`No updates needed for invoice ${zohoInvoiceId}`);
      return {
        status: "no_changes",
        invoice_id: zohoInvoiceId,
        local_id: existingInvoice._id
      };
    }

  } catch (error) {
    console.error("Error processing invoice status update:", error);
    throw error;
  }
}

// Handle payment received webhook from Zoho Books
async function handlePaymentReceived(paymentData) {
  try {
    console.log("Processing payment received event:", {
      payment_id: paymentData.payment_id,
      payment_number: paymentData.payment_number,
      customer_id: paymentData.customer_id,
      amount: paymentData.amount,
      date: paymentData.date,
      payment_mode: paymentData.payment_mode,
      status: paymentData.status,
      invoices: paymentData.invoices?.length || 0
    });

    if (!paymentData.payment_id) {
      console.warn("No payment_id found in payment webhook payload");
      return { status: "ignored", reason: "No payment_id" };
    }

    // Check if payment already exists to avoid duplicates
    const existingPayment = await Payment.findOne({ zoho_payment_id: paymentData.payment_id });
    
    // Check for idempotency - don't update if we have newer data
    if (existingPayment && existingPayment.updatedAt) {
      const existingModifiedTime = new Date(existingPayment.updatedAt);
      const incomingModifiedTime = paymentData.last_modified_time ? 
        new Date(paymentData.last_modified_time) : new Date();
      
      if (incomingModifiedTime <= existingModifiedTime) {
        console.log(`Skipping payment ${paymentData.payment_id} - incoming data is not newer`);
        return {
          action: "skipped",
          reason: "not_newer",
          payment_id: paymentData.payment_id
        };
      }
    }
    let client = null;
    if (paymentData.customer_id) {
      client = await Client.findOne({ zohoBooksContactId: paymentData.customer_id });
      if (!client) {
        console.warn(`No client found with zohoBooksContactId: ${paymentData.customer_id} for payment ${paymentData.payment_id}`);
      }
    }
    const invoiceApplications = [];
    const invoiceUpdateResults = [];
    
    if (paymentData.invoices && Array.isArray(paymentData.invoices)) {
      for (const invoiceApplication of paymentData.invoices) {
        const zohoInvoiceId = invoiceApplication.invoice_id;
        const amountApplied = parseFloat(invoiceApplication.amount_applied || 0);
        const localInvoice = await Invoice.findOne({ zoho_invoice_id: zohoInvoiceId });
        
        if (localInvoice) {
          const currentAmountPaid = parseFloat(localInvoice.amount_paid || 0);
          const newAmountPaid = currentAmountPaid + amountApplied;
          const newBalance = Math.max(0, parseFloat(localInvoice.total || 0) - newAmountPaid);
          
          const invoiceUpdateData = {
            amount_paid: newAmountPaid,
            balance: newBalance,
            last_payment_date: new Date(paymentData.date)
          };
          if (newBalance === 0) {
            invoiceUpdateData.status = "paid";
            invoiceUpdateData.paid_at = new Date(paymentData.date);
          } else if (localInvoice.status === "draft") {
            invoiceUpdateData.status = "partially_paid";
          } else if (localInvoice.status !== "partially_paid" && localInvoice.status !== "paid") {
            invoiceUpdateData.status = "partially_paid";
          }
          
          await Invoice.findByIdAndUpdate(localInvoice._id, invoiceUpdateData);
          console.log(`Updated invoice ${localInvoice.invoice_number} with payment of ${amountApplied}`);
          
          invoiceApplications.push({
            invoice: localInvoice._id,
            amount_applied: amountApplied,
            zoho_invoice_id: zohoInvoiceId
          });
          
          invoiceUpdateResults.push({
            invoice_id: localInvoice._id,
            invoice_number: localInvoice.invoice_number,
            amount_applied: amountApplied,
            new_balance: newBalance
          });
        } else {
          console.warn(`Local invoice not found for Zoho invoice ID: ${zohoInvoiceId}`);
        }
      }
    }

    // Map Zoho payment mode to our payment types
    const mapPaymentMode = (zohoMode) => {
      const modeMap = {
        'bank_transfer': 'Bank Transfer',
        'banktransfer': 'Bank Transfer',
        'cash': 'Cash',
        'check': 'Cheque',
        'cheque': 'Cheque',
        'creditcard': 'CreditCard',
        'credit_card': 'CreditCard',
        'debitcard': 'DebitCard',
        'debit_card': 'DebitCard',
        'paypal': 'PayPal',
        'upi': 'UPI',
        'card': 'Card',
        'online': 'Online Gateway',
        'other': 'Other'
      };
      
      return modeMap[zohoMode?.toLowerCase()] || 'Other';
    };

    // Prepare payment data for local storage
    const paymentDataToStore = {
      client: client ? client._id : null,
      invoices: invoiceApplications,
      type: mapPaymentMode(paymentData.payment_mode),
      amount: parseFloat(paymentData.amount || 0),
      paymentDate: new Date(paymentData.date),
      referenceNumber: paymentData.reference_number || paymentData.payment_number,
      notes: paymentData.description || paymentData.notes || `Payment received via Zoho Books - ${paymentData.payment_number}`,
      currency: paymentData.currency_code || 'INR',
      
      // Zoho-specific fields
      customer_id: paymentData.customer_id,
      zoho_payment_id: paymentData.payment_id,
      payment_number: paymentData.payment_number,
      zoho_status: paymentData.status,
      deposit_to_account_id: paymentData.account_id,
      
      // Audit fields
      raw_zoho_response: paymentData,
      source: 'webhook'
    };

    // Handle single invoice case for backward compatibility
    if (invoiceApplications.length === 1 && invoiceApplications[0].invoice) {
      paymentDataToStore.invoice = invoiceApplications[0].invoice;
    }

    let result;
    if (existingPayment) {
      // Update existing payment
      await Payment.findByIdAndUpdate(existingPayment._id, paymentDataToStore);
      console.log(`Updated payment ${paymentData.payment_id} in database`);
      result = {
        action: "updated",
        payment_id: paymentData.payment_id,
        local_id: existingPayment._id,
        amount: paymentData.amount,
        invoices_updated: invoiceUpdateResults
      };
    } else {
      // Create new payment
      const newPayment = await Payment.create(paymentDataToStore);
      console.log(`Created payment ${paymentData.payment_id} in database with local ID ${newPayment._id}`);
      result = {
        action: "created",
        payment_id: paymentData.payment_id,
        local_id: newPayment._id,
        amount: paymentData.amount,
        invoices_updated: invoiceUpdateResults
      };
    }

    // Add client linking info to result
    if (client) {
      result.client_linked = true;
      result.client_id = client._id;
      result.client_name = client.companyName;
    } else {
      result.client_linked = false;
      result.customer_id = paymentData.customer_id;
    }

    return result;

  } catch (error) {
    console.error("Error processing payment webhook:", error);
    throw error;
  }
}
