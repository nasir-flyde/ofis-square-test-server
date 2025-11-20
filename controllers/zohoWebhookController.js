import crypto from "crypto";
import axios from "axios";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import { createInvoiceFromContract } from "../services/invoiceService.js";
import { getAccessToken } from "../utils/zohoSignAuth.js";
import { createZohoInvoiceFromLocal, findOrCreateContactFromClient } from "../utils/zohoBooks.js";
import fetch from "node-fetch";
import { sendWelcomeEmail } from "../utils/emailService.js";

export const handleZohoSignWebhook = async (req, res) => {
  try {
    console.log("Zoho Sign webhook received:", {
      headers: req.headers,
      body: req.body,
      timestamp: new Date().toISOString()
    });
    const secret = process.env.ZOHO_SIGN_WEBHOOK_SECRET;
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
          console.error("Webhook signature verification failed:", {
            received: sigHeader,
            expected: hmac,
            expectedWithPrefix: expectedSignature
          });
          return res.status(401).json({ 
            error: "Invalid webhook signature",
            timestamp: new Date().toISOString()
          });
        }
        console.log("Webhook signature verified successfully");
      } catch (e) {
        console.error("Webhook signature verification error:", e);
        return res.status(401).json({ 
          error: "Webhook signature verification failed",
          timestamp: new Date().toISOString()
        });
      }
    } else if (secret) {
      console.warn("Webhook secret configured but no signature header found");
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

    const result = await processZohoSignEvent(payload);
    
    return res.status(200).json({
      message: "Webhook processed successfully",
      result,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Zoho Sign webhook error:", err);
    return res.status(500).json({ 
      error: "Webhook processing failed",
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

async function processZohoSignEvent(payload) {
  const requests = payload?.requests || {};
  const notifications = payload?.notifications || {};
  
  const { 
    request_id, 
    request_status, 
    actions,
    document_ids,
    owner_email,
    request_name
  } = requests;

  const {
    event_type,
    operation_type,
    performed_by_email,
    activity
  } = notifications;
  const finalRequestId = request_id || payload?.request_id;
  const finalRequestStatus = request_status || payload?.request_status;
  const finalEventType = event_type || payload?.event_type || operation_type;

  console.log("Processing Zoho Sign event:", {
    request_id: finalRequestId,
    request_status: finalRequestStatus,
    event_type: finalEventType,
    operation_type,
    activity,
    owner_email,
    request_name
  });

  if (!finalRequestId) {
    console.warn("No request_id found in webhook payload", { payload });
    return { status: "ignored", reason: "No request_id provided" };
  }

  const contract = await Contract.findOne({ zohoSignRequestId: finalRequestId })
    .populate("client", "companyName email contactPerson")
    .populate("building", "name address");

  if (!contract) {
    console.log(`Webhook received for unknown request_id: ${finalRequestId}`);
    return { 
      status: "ignored", 
      reason: "Contract not found",
      request_id: finalRequestId 
    };
  }

  console.log(`Found contract ${contract._id} for request_id: ${finalRequestId}`);

  // Process based on event type or request status
  const updateResult = await updateContractStatus(contract, {
    request_status: finalRequestStatus,
    event_type: finalEventType,
    operation_type,
    activity,
    actions,
    performed_by_email,
    document_ids: requests?.document_ids || payload?.document_ids
  });

  return {
    status: "processed",
    contract_id: contract._id,
    old_status: contract.status,
    ...updateResult
  };
}

async function updateContractStatus(contract, eventData) {
  const { request_status, event_type, operation_type, activity, actions, performed_by_email, document_ids } = eventData;
  
  let newStatus = contract.status;
  let updateData = {};
  let actionTaken = "none";
  switch (request_status) {
    case "completed":
    case "signed":
      if (contract.status !== "active") {
        newStatus = "active";
        updateData.signedAt = new Date();
        updateData.isclientsigned = true; // Set client signed flag to true
        actionTaken = "activated";
        console.log(`Contract ${contract._id} marked as active (signed)`);
      }
      break;

    case "declined":
    case "rejected":
      if (contract.status === "pending_signature") {
        newStatus = "draft";
        updateData.declinedAt = new Date();
        actionTaken = "declined";
        console.log(`Contract ${contract._id} declined, reset to draft`);
      }
      break;

    case "expired":
      if (contract.status === "pending_signature") {
        newStatus = "draft";
        updateData.expiredAt = new Date();
        actionTaken = "expired";
        console.log(`Contract ${contract._id} expired, reset to draft`);
      }
      break;

    case "in_progress":
    case "sent":
      // Document is sent and waiting for signature
      if (contract.status === "draft") {
        newStatus = "pending_signature";
        actionTaken = "sent_for_signature";
        console.log(`Contract ${contract._id} sent for signature`);
      }
      break;

    default:
      console.log(`Unhandled request_status: ${request_status} for contract ${contract._id}`);
  }

  // Handle specific event types and operation types
  const eventToCheck = event_type || operation_type;
  if (eventToCheck) {
    switch (eventToCheck) {
      case "REQUEST_SIGNED":
      case "DOCUMENT_SIGNED":
      case "RequestCompleted":
        if (contract.status !== "active") {
          newStatus = "active";
          updateData.signedAt = new Date();
          updateData.isclientsigned = true; // Set client signed flag to true
          actionTaken = "activated";
        }
        break;

      case "REQUEST_DECLINED":
      case "DOCUMENT_DECLINED":
      case "RequestDeclined":
        if (contract.status === "pending_signature") {
          newStatus = "draft";
          updateData.declinedAt = new Date();
          actionTaken = "declined";
        }
        break;

      case "REQUEST_EXPIRED":
      case "RequestExpired":
        if (contract.status === "pending_signature") {
          newStatus = "draft";
          updateData.expiredAt = new Date();
          actionTaken = "expired";
        }
        break;

      case "RequestSent":
      case "REQUEST_SENT":
        if (contract.status === "draft") {
          newStatus = "pending_signature";
          actionTaken = "sent_for_signature";
        }
        break;
    }
  }

  // Handle activity-based detection
  if (activity && typeof activity === "string") {
    if (activity.toLowerCase().includes("completed")) {
      if (contract.status !== "active") {
        newStatus = "active";
        updateData.signedAt = new Date();
        updateData.isclientsigned = true; // Set client signed flag to true
        actionTaken = "activated";
      }
    } else if (activity.toLowerCase().includes("declined")) {
      if (contract.status === "pending_signature") {
        newStatus = "draft";
        updateData.declinedAt = new Date();
        actionTaken = "declined";
      }
    } else if (activity.toLowerCase().includes("expired")) {
      if (contract.status === "pending_signature") {
        newStatus = "draft";
        updateData.expiredAt = new Date();
        actionTaken = "expired";
      }
    }
  }

  // Update contract if status changed
  if (newStatus !== contract.status) {
    updateData.status = newStatus;
    await Contract.findByIdAndUpdate(contract._id, updateData);
    console.log(`Contract ${contract._id} status updated: ${contract.status} → ${newStatus}`);
    if (newStatus === "active" && contract.zohoSignRequestId) {
      try {
        let signedDocumentData = null;
        const documentIds = eventData.requests?.document_ids || eventData.document_ids;
        
        console.log(`Checking for document_ids in webhook payload for contract ${contract._id}:`, documentIds);
        
        if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
          const firstDoc = documentIds[0];
          console.log(`First document structure:`, firstDoc);
          if (firstDoc.image_string) {
            signedDocumentData = `data:image/jpeg;base64,${firstDoc.image_string}`;
            console.log(`Found signed document in webhook payload for contract ${contract._id}, image_string length:`, firstDoc.image_string.length);
          } else {
            console.log(`No image_string found in first document for contract ${contract._id}`);
          }
        } else {
          console.log(`No document_ids found in webhook payload for contract ${contract._id}`);
        }
        if (!signedDocumentData) {
          console.log(`Attempting to fetch signed document from Zoho Sign API for request ${contract.zohoSignRequestId}`);
          signedDocumentData = await fetchSignedDocumentFromZoho(contract.zohoSignRequestId);
        }
        
        if (signedDocumentData) {
          updateData.fileUrl = signedDocumentData;
          await Contract.findByIdAndUpdate(contract._id, { fileUrl: signedDocumentData });
          console.log(`Updated contract ${contract._id} with signed document data`);
          actionTaken += "_with_signed_document";
        }
      } catch (docError) {
        console.error("Failed to process signed document:", docError);
        // Don't fail the webhook processing if document processing fails
      }

      // Auto-create invoice when contract becomes active
      try {
        const invoice = await createInvoiceFromContract(contract._id, {
          issueOn: "activation",
          prorate: true,
          includeDeposit: true,
          dueDays: 7
        });
        console.log(`✅ Auto-created invoice ${invoice._id} for contract ${contract._id} via webhook`);
        actionTaken += "_with_invoice";

        // Automatically push invoice to Zoho Books
        try {
          const populatedInvoice = await Invoice.findById(invoice._id).populate('client');
          const client = populatedInvoice.client;

          if (!client) {
            console.warn(`⚠️ Cannot push invoice to Zoho: Client not found for invoice ${invoice._id}`);
          } else {
            // Ensure client has Zoho Books contact
            if (!client.zohoBooksContactId) {
              console.log(`Creating Zoho Books contact for client ${client._id}`);
              const contactId = await findOrCreateContactFromClient(client);
              if (contactId) {
                client.zohoBooksContactId = contactId;
                await client.save();
                console.log(`✅ Created Zoho Books contact ${contactId} for client ${client._id}`);
              } else {
                console.error(`❌ Failed to create Zoho Books contact for client ${client._id}`);
              }
            }

            if (client.zohoBooksContactId) {
              // Push invoice to Zoho Books
              console.log(`Pushing invoice ${invoice._id} to Zoho Books...`);
              const zohoResp = await createZohoInvoiceFromLocal(
                populatedInvoice.toObject(), 
                client.toObject ? client.toObject() : client
              );
              
              const zohoId = zohoResp?.invoice?.invoice_id;
              const zohoNumber = zohoResp?.invoice?.invoice_number;
              
              if (zohoId) {
                populatedInvoice.zoho_invoice_id = zohoId;
                populatedInvoice.zoho_invoice_number = zohoNumber || populatedInvoice.zoho_invoice_number;
                populatedInvoice.source = populatedInvoice.source || "zoho";
                populatedInvoice.status = 'sent'; // Mark as sent since contract is signed
                populatedInvoice.sent_at = new Date();
                await populatedInvoice.save();
                
                console.log(`✅ Invoice ${invoice._id} pushed to Zoho Books (ID: ${zohoId}, Number: ${zohoNumber})`);
                actionTaken += "_pushed_to_zoho";
              } else {
                console.error(`❌ Zoho Books did not return invoice_id for invoice ${invoice._id}`);
              }
            }
          }
        } catch (zohoError) {
          console.error(`❌ Failed to push invoice to Zoho Books:`, zohoError.message);
          // Don't fail the webhook processing if Zoho push fails
        }
      } catch (invoiceError) {
        console.error("❌ Failed to auto-create invoice from webhook:", invoiceError);
        // Don't fail the webhook processing if invoice creation fails
      }
    }
  }

  return {
    new_status: newStatus,
    action_taken: actionTaken,
    updated_fields: Object.keys(updateData)
  };
}


// Health check endpoint for webhook
export const webhookHealthCheck = async (req, res) => {
  return res.status(200).json({
    status: "healthy",
    service: "Zoho Sign Webhook Handler",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
};

// Test endpoint for webhook (development only)
export const testWebhook = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const testPayload = {
    request_id: "test_request_123",
    request_status: "completed",
    event_type: "REQUEST_SIGNED",
    recipient_email: "test@example.com",
    recipient_name: "Test User",
    timestamp: new Date().toISOString()
  };

  try {
    const result = await processZohoSignEvent(testPayload);
    return res.status(200).json({
      message: "Test webhook processed",
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

async function fetchSignedDocumentFromZoho(requestId) {
  try {
    console.log(`Fetching signed document for request ${requestId} from Zoho Sign API`);
    const accessToken = await getAccessToken();
    const response = await fetch(`https://sign.zoho.in/api/v1/requests/${requestId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Zoho Sign API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Zoho Sign API response for request ${requestId}:`, {
      status: data.status,
      document_ids_count: data.requests?.document_ids?.length || 0
    });
    const documentIds = data.requests?.document_ids || [];
    
    for (const doc of documentIds) {
      console.log(`Checking document ${doc.document_id} for image_string:`, {
        document_name: doc.document_name,
        has_image_string: !!doc.image_string,
        image_string_length: doc.image_string?.length || 0
      });
      
      if (doc.image_string) {
        console.log(`Found signed document image_string for request ${requestId}, length: ${doc.image_string.length}`);
        return `data:image/jpeg;base64,${doc.image_string}`;
      }
    }
    
    console.log(`No image_string found in any document for request ${requestId}`);
    return null;
    
  } catch (error) {
    console.error(`Error fetching signed document for request ${requestId}:`, error.message);
    return null;
  }
}
