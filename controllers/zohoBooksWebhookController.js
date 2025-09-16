import crypto from "crypto";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Member from "../models/memberModel.js";
import { sendWelcomeEmail } from "../utils/emailService.js";

// Handle Zoho Books contact creation webhook
export const handleZohoBooksWebhook = async (req, res) => {
  try {
    console.log("Zoho Books webhook received:", {
      headers: req.headers,
      body: req.body,
      timestamp: new Date().toISOString()
    });

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

    let payload;
    try {
      payload = typeof rawBodyStr === "string" && rawBodyStr.length ? 
                JSON.parse(rawBodyStr) : req.body;
    } catch (e) {
      console.error("Invalid JSON payload:", e);
      return res.status(400).json({ 
        error: "Invalid JSON payload",
        timestamp: new Date().toISOString()
      });
    }

    // Process the webhook event
    const result = await processZohoBooksEvent(payload);
    
    return res.status(200).json({
      message: "Zoho Books webhook processed successfully",
      result,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Zoho Books webhook error:", err);
    return res.status(500).json({ 
      error: "Webhook processing failed",
      message: err.message,
      timestamp: new Date().toISOString()
    });
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
    has_payload_field: !!payload?.payload,
    payload_content: payload?.payload
  });

  // Handle webhook verification or test requests (empty payload)
  if (payload?.payload === '' || (Object.keys(payload).length === 1 && payload?.payload !== undefined)) {
    console.log("Detected Zoho Books webhook verification/test request");
    return { 
      status: "verified", 
      reason: "Webhook verification successful",
      message: "Zoho Books webhook endpoint is working correctly"
    };
  }

  // If Zoho sent form-encoded with a JSON string in `payload`, parse it and re-process
  if (typeof payload?.payload === 'string' && payload.payload.trim().length > 0) {
    try {
      const parsed = JSON.parse(payload.payload);
      console.log("Parsed JSON from form-encoded payload");
      return await processZohoBooksEvent(parsed);
    } catch (e) {
      console.warn("Failed to parse payload JSON string:", e?.message || e);
    }
  }

  // Handle contact creation events with explicit event type
  if (eventType === "contact_created" || eventType === "ContactCreated") {
    return await handleContactCreated(data);
  }

  // Handle contact update events with explicit event type
  if (eventType === "contact_updated" || eventType === "ContactUpdated") {
    return await handleContactUpdated(data);
  }

  // Handle direct contact/customer payload (Zoho Books may send contact or customer directly without event_type)
  if ((payload?.contact || payload?.customer) && !eventType) {
    console.log("Detected direct contact payload from Zoho Books webhook");
    
    // Check if this is a new contact by looking at created_time vs last_modified_time
    const contact = payload.contact || payload.customer;
    const createdTime = new Date(contact.created_time);
    const modifiedTime = new Date(contact.last_modified_time);
    
    // If created and modified times are very close (within 5 seconds), treat as creation
    const timeDiff = Math.abs(modifiedTime.getTime() - createdTime.getTime());
    const isNewContact = timeDiff < 5000; // 5 seconds threshold
    
    if (isNewContact) {
      console.log("Processing as contact creation event");
      return await handleContactCreated({ contact });
    } else {
      console.log("Processing as contact update event");
      return await handleContactUpdated({ contact });
    }
  }

  console.log(`Unhandled Zoho Books event type: ${eventType}`);
  return { 
    status: "ignored", 
    reason: "Unhandled event type or missing contact data",
    event_type: eventType,
    has_contact: !!payload?.contact,
    has_customer: !!payload?.customer,
    payload_keys: Object.keys(payload || {})
  };
}

async function handleContactCreated(contactData) {
  try {
    const contact = contactData?.contact || contactData?.customer || contactData;
    
    if (!contact) {
      console.warn("No contact data found in webhook payload");
      return { status: "ignored", reason: "No contact data" };
    }

    const contactId = contact.contact_id || contact.customer_id;
    const email = contact.email;
    const companyName = contact.company_name || contact.contact_name || contact.customer_name;

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

    // Create user and member records if email and phone are available
    let createdUserId = null;
    if (newClient.email && newClient.phone) {
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

async function mapZohoContactToClient(contact) {
  // Map Zoho contact/customer fields to client model
  const clientData = {
    companyName: contact.company_name || contact.customer_name || contact.contact_name || "Unknown Company",
    legalName: contact.legal_name || contact.company_name || contact.customer_name,
    contactPerson: contact.contact_name || contact.customer_name || (contact.first_name && contact.last_name ? `${contact.first_name} ${contact.last_name}` : undefined) || "Unknown",
    email: contact.email ? String(contact.email).toLowerCase().trim() : undefined,
    phone: contact.phone || contact.mobile || undefined,
    website: contact.website || undefined,
    
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
    zohoBooksContactId: contact.contact_id || contact.customer_id,
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

  const testPayload = {
    event_type: "contact_created",
    data: {
      contact: {
        contact_id: "test_contact_123",
        contact_name: "Test Company",
        company_name: "Test Company Ltd",
        email: "test@testcompany.com",
        phone: "+1234567890",
        contact_type: "customer",
        customer_sub_type: "business",
        billing_address: {
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

  try {
    const result = await processZohoBooksEvent(testPayload);
    return res.status(200).json({
      message: "Test Zoho Books webhook processed",
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
