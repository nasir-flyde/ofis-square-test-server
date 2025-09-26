import mongoose from "mongoose";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import crypto from "crypto";
import { getAccessToken } from "../utils/zohoSignAuth.js";
import imagekit from "../utils/imageKit.js";
import PdfPrinter from "pdfmake";
import getContractTemplate from "./contractTemplate.js";
import { createInvoiceFromContract } from "../services/invoiceService.js";
import { logCRUDActivity, logContractActivity, logErrorActivity, logSystemActivity } from "../utils/activityLogger.js";
import LoggedZohoSign from "../utils/loggedZohoSign.js";
import apiLogger from "../utils/apiLogger.js";

// Create a new contract (admin only)
export const createContract = async (req, res) => {
  try {
    const {
      clientId,
      buildingId,
      capacity,
      monthlyRent: monthlyRentOverride,
      initialCredits,
      creditValueAtSignup,
      contractStartDate,
      contractEndDate,
      terms,
    } = req.body || {};

 

    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!buildingId) return res.status(400).json({ error: "buildingId is required" });
    if (!capacity || capacity <= 0) return res.status(400).json({ error: "capacity must be a positive number" });

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid clientId" });
    }
    if (!mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ error: "Invalid buildingId" });
    }

    // Fetch building to get pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    if (building.status !== "active") {
      return res.status(400).json({ error: "Building is not active" });
    }
    if (building.pricing == null || building.pricing < 0) {
      return res.status(400).json({ error: "Building pricing is not configured" });
    }

    // Compute monthly rent (allow override if provided)
    let monthlyRent = null;
    if (monthlyRentOverride !== undefined && monthlyRentOverride !== null && monthlyRentOverride !== "") {
      const mr = Number(monthlyRentOverride);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ error: "monthlyRent must be a non-negative number" });
      }
      monthlyRent = mr;
    } else {
      monthlyRent = building.pricing * Number(capacity);
    }

    const start = contractStartDate ? new Date(contractStartDate) : new Date();
    const end = contractEndDate ? new Date(contractEndDate) : new Date(Date.now() + 365*24*60*60*1000);

    const payload = {
      client: clientId,
      building: buildingId,
      startDate: start,
      endDate: end,
      capacity: Number(capacity),
      monthlyRent: monthlyRent,
      ...(initialCredits && { initialCredits: Number(initialCredits) }),
      ...(creditValueAtSignup && { creditValueAtSignup: Number(creditValueAtSignup) }),
      ...(terms && { terms }),
      status: "draft",
      fileUrl: "placeholder",
    };

    const created = await Contract.create(payload);

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Contract', created._id, null, {
      clientId,
      buildingId,
      capacity,
      monthlyRent,
      startDate: start,
      endDate: end
    });

    // Auto-generate and upload contract PDF
    try {
      const populatedContract = await Contract.findById(created._id)
        .populate("client")
        .populate("building", "name address pricing");
      
      const pdfBuffer = await generateContractPDFBuffer(populatedContract);
      const fileName = `contract_${created._id}_${Date.now()}.pdf`;
      
      const uploadResponse = await imagekit.upload({
        file: pdfBuffer,
        fileName: fileName,
        folder: "/contracts"
      });
      
      // Update contract with the uploaded PDF URL
      await Contract.findByIdAndUpdate(created._id, { fileUrl: uploadResponse.url });
      created.fileUrl = uploadResponse.url;
      
      console.log(`Contract PDF uploaded: ${uploadResponse.url}`);
    } catch (pdfError) {
      console.error("Failed to generate/upload contract PDF:", pdfError);
      // Don't fail contract creation if PDF upload fails
    }

    // Update client with building ID when contract is created
    try {
      await Client.findByIdAndUpdate(clientId, { building: buildingId });
      console.log(`Updated client ${clientId} with building ${buildingId}`);
    } catch (clientUpdateError) {
      console.error("Failed to update client building:", clientUpdateError);
    }

    // Grant initial credits if specified
    if (initialCredits && Number(initialCredits) > 0) {
      const WalletService = (await import("../services/walletService.js")).default;
      if (initialCredits > 0) {
        try {
          await WalletService.grantCredits({
            clientId,
            credits: initialCredits,
            refType: "contract",
            refId: created._id,
            meta: { contractId: created._id, capacity, monthlyRent }
          });
          console.log(`Granted ${initialCredits} credits to client ${clientId}`);
        } catch (creditError) {
          console.error("Failed to grant credits:", creditError);
        }
      }
    }

    return res.status(201).json({ message: "Contract created", contract: created });
  } catch (err) {
    console.error("createContract error:", err);
    await logErrorActivity(req, err, 'Contract Creation');
    return res.status(500).json({ error: "Failed to create contract" });
  }
};

// Zoho Sign API configuration
function getZohoSignBaseUrl() {
  const signDc = process.env.ZOHO_SIGN_DC; // e.g., sign.zoho.in
  if (signDc) return `https://${signDc}/api/v1`;
  const accountsDc = process.env.ZOHO_DC || "accounts.zoho.in";
  // Map accounts.* to sign.*
  if (accountsDc.endsWith("zoho.in")) return "https://sign.zoho.in/api/v1";
  if (accountsDc.endsWith("zoho.eu")) return "https://sign.zoho.eu/api/v1";
  if (accountsDc.endsWith("zoho.com.cn")) return "https://sign.zoho.com.cn/api/v1";
  // default
  return "https://sign.zoho.in/api/v1";
}
const ZOHO_SIGN_BASE_URL = getZohoSignBaseUrl();

// Get all contracts
export const getContracts = async (req, res) => {
  try {
    const contracts = await Contract.find()
      .populate("client", "companyName email contactPerson phone companyAddress")
      .populate("building", "name address pricing city state")
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: contracts });
  } catch (err) {
    console.error("getContracts error:", err);
    await logErrorActivity(req, err, 'Get Contracts');
    return res.status(500).json({ success: false, message: "Failed to fetch contracts" });
  }
};

// Get contract by ID
export const getContractById = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client", "companyName email contactPerson phone companyAddress")
      .populate("building", "name address pricing city state");
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });
    return res.json({ success: true, data: contract });
  } catch (err) {
    console.error("getContractById error:", err);
    await logErrorActivity(req, err, 'Get Contract by ID');
    return res.status(500).json({ success: false, message: "Failed to fetch contract" });
  }
};

// Delete a contract (admin only)
export const deleteContract = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid contract id" });
    }

    const existing = await Contract.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    await Contract.deleteOne({ _id: id });
    
    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Contract', id, null, {
      clientId: existing.client,
      buildingId: existing.building
    });
    
    return res.json({ success: true, message: "Contract deleted" });
  } catch (err) {
    console.error("deleteContract error:", err);
    await logErrorActivity(req, err, 'Delete Contract');
    return res.status(500).json({ success: false, message: "Failed to delete contract" });
  }
};

// Update a contract (admin only)
export const updateContract = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      clientId,
      buildingId,
      capacity,
      monthlyRent: monthlyRentOverride,
      initialCredits,
      creditValueAtSignup,
      securityDeposit,
      contractStartDate,
      contractEndDate,
      terms,
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid contract id" });
    }

    const existing = await Contract.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }

    // Validation
    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!buildingId) return res.status(400).json({ error: "buildingId is required" });
    if (!capacity || capacity <= 0) return res.status(400).json({ error: "capacity must be a positive number" });

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: "Invalid clientId" });
    }
    if (!mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ error: "Invalid buildingId" });
    }

    // Fetch building to get pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    if (building.status !== "active") {
      return res.status(400).json({ error: "Building is not active" });
    }
    if (building.pricing == null || building.pricing < 0) {
      return res.status(400).json({ error: "Building pricing is not configured" });
    }

    // Compute monthly rent (allow override if provided)
    let monthlyRent = null;
    if (monthlyRentOverride !== undefined && monthlyRentOverride !== null && monthlyRentOverride !== "") {
      const mr = Number(monthlyRentOverride);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ error: "monthlyRent must be a non-negative number" });
      }
      monthlyRent = mr;
    } else {
      monthlyRent = building.pricing * Number(capacity);
    }

    const start = contractStartDate ? new Date(contractStartDate) : existing.startDate;
    const end = contractEndDate ? new Date(contractEndDate) : existing.endDate;

    const updateData = {
      client: clientId,
      building: buildingId,
      startDate: start,
      endDate: end,
      capacity: Number(capacity),
      monthlyRent: monthlyRent,
      ...(initialCredits && { initialCredits: Number(initialCredits) }),
      ...(creditValueAtSignup && { creditValueAtSignup: Number(creditValueAtSignup) }),
      ...(terms && { terms }),
    };

    const updated = await Contract.findByIdAndUpdate(id, updateData, { new: true });
    
    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Contract', id, {
      before: existing.toObject(),
      after: updated.toObject(),
      fields: Object.keys(updateData)
    }, {
      clientId,
      buildingId,
      updatedFields: Object.keys(updateData)
    });
    
    return res.json({ success: true, message: "Contract updated", contract: updated });
  } catch (err) {
    console.error("updateContract error:", err);
    await logErrorActivity(req, err, 'Update Contract');
    return res.status(500).json({ success: false, message: "Failed to update contract" });
  }
};

// Send contract for digital signature
export const sendForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (contract.status !== "draft") {
      return res.status(400).json({ error: "Only draft contracts can be sent for signature" });
    }
    if (!contract.client) return res.status(400).json({ error: "Contract client not found" });

    // Use logged Zoho Sign wrapper for all API calls
    const loggedZohoSign = new LoggedZohoSign();
    
    // Step 1: Create document in Zoho Sign
    const requestId = await loggedZohoSign.createDocument(contract);
    console.log("Document created with request ID:", requestId);
    
    // Step 2: Verify document exists and get document ID
    const documentDetails = await loggedZohoSign.verifyDocumentExists(requestId);
    const documentId = documentDetails?.document_ids?.[0]?.document_id;
    if (!documentId) {
      throw new Error("Failed to get document ID from Zoho Sign");
    }
    console.log("Document verified with ID:", documentId);
    
    // Step 3: Add recipient to document
    await loggedZohoSign.addRecipient(requestId, contract.client, documentId);
    console.log("Recipient added to document");
    
    // Step 4: Submit document for signature
    await loggedZohoSign.submitDocument(requestId);
    console.log("Document submitted for signature");

    // Update contract status and store Zoho Sign request ID
    const updatedContract = await Contract.findByIdAndUpdate(
      id,
      { 
        status: "pending_signature",
        zohoSignRequestId: requestId,
        sentForSignatureAt: new Date()
      },
      { new: true }
    );

    // Log contract activity
    await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', 'Contract', id, {
      zohoSignRequestId: requestId,
      clientEmail: contract.client.email,
      clientName: contract.client.companyName
    });

    return res.json({ 
      message: "Contract sent for digital signature", 
      contract: updatedContract,
      zohoSignRequestId: requestId
    });
  } catch (err) {
    console.error("sendForSignature error:", err);
    await logErrorActivity(req, err, 'Send Contract for Signature');
    return res.status(500).json({ error: "Failed to send contract for signature" });
  }
};

// Check signature status
export const checkSignatureStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (!contract.zohoSignRequestId) {
      return res.status(400).json({ error: "Contract not sent for signature yet" });
    }

    const loggedZohoSign = new LoggedZohoSign();
    const status = await loggedZohoSign.getDocumentStatus(contract.zohoSignRequestId);
    
    // Update contract status based on Zoho Sign status
    let newStatus = contract.status;
    if (status.request_status === "completed") {
      newStatus = "active";
      await Contract.findByIdAndUpdate(id, { 
        status: "active",
        signedAt: new Date()
      });
      
      // Log contract completion
      await logContractActivity(req, 'CONTRACT_SIGNED', 'Contract', id, {
        zohoSignRequestId: contract.zohoSignRequestId,
        signatureStatus: status.request_status
      });
    }

    return res.json({ 
      contractStatus: newStatus,
      zohoSignStatus: status.request_status,
      signatureDetails: status
    });
  } catch (err) {
    console.error("checkSignatureStatus error:", err);
    await logErrorActivity(req, err, 'Check Signature Status');
    return res.status(500).json({ error: "Failed to check signature status" });
  }
};

// Frontdesk/manual: upload a signed contract file or provide a fileUrl and mark as active
export const uploadSignedContract = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    // Accept either an uploaded file (multer) or a direct fileUrl
    let fileUrl = req.body?.fileUrl;
    // Support both upload.single (req.file) and upload.any (req.files)
    let uploadedFile = req.file;
    if (!uploadedFile && Array.isArray(req.files) && req.files.length > 0) {
      uploadedFile = req.files[0];
    }
    if (uploadedFile) {
      // Basic guard: ensure it's a PDF or image (customize as needed)
      const allowed = ["application/pdf", "image/png", "image/jpeg"];
      if (uploadedFile.mimetype && !allowed.includes(uploadedFile.mimetype)) {
        return res.status(400).json({ error: "Unsupported file type" });
      }
      
      // Upload to ImageKit
      try {
        const fileName = `contract_${id}_${Date.now()}_${uploadedFile.originalname}`;
        const uploadResponse = await imagekit.upload({
          file: uploadedFile.buffer,
          fileName: fileName,
          folder: "/contracts"
        });
        fileUrl = uploadResponse.url;
      } catch (uploadError) {
        console.error("ImageKit upload error:", uploadError);
        return res.status(500).json({ error: "Failed to upload file to ImageKit" });
      }
    }

    if (!fileUrl) {
      return res.status(400).json({ error: "Provide a file upload or fileUrl" });
    }

    contract.fileUrl = fileUrl;
    contract.status = "active";
    contract.signedAt = new Date();
    // Optional: clear zohoSignRequestId if this path bypassed Zoho Sign
    // contract.zohoSignRequestId = undefined;

    await contract.save();
    
    // Log contract activation
    await logContractActivity(req, 'CONTRACT_ACTIVATED', 'Contract', id, {
      fileUrl,
      activationMethod: 'manual_upload'
    });
    try {
      const invoice = await createInvoiceFromContract(contract._id, {
        issueOn: "activation",
        prorate: true,
        dueDays: 7
      });
      console.log(`Auto-created invoice ${invoice._id} for contract ${contract._id}`);
    } catch (invoiceError) {
      console.error("Failed to auto-create invoice:", invoiceError);
      // Don't fail the contract activation if invoice creation fails
    }

    return res.status(200).json({
      message: "Contract marked as active with uploaded signed file",
      contract,
    });
  } catch (err) {
    console.error("uploadSignedContract error:", err);
    await logErrorActivity(req, err, 'Upload Signed Contract');
    return res.status(500).json({ error: "Failed to upload signed contract" });
  }
};

// Webhook handler for Zoho Sign events
export const handleZohoSignWebhook = async (req, res) => {
  const requestId = await apiLogger.logIncomingWebhook(
    'zoho_sign',
    'signature_webhook',
    req.headers,
    req.body,
    {
      requestId: req.body?.request_id,
      status: req.body?.request_status
    }
  );

  try {
    // Verify webhook signature if configured, using raw buffer
    const secret = process.env.ZOHO_SIGN_WEBHOOK_SECRET;
    const sigHeader = req.headers["x-zoho-webhook-signature"] || req.headers["x-zoho-signature"];
    let rawBodyStr = "";
    if (Buffer.isBuffer(req.body)) {
      rawBodyStr = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      rawBodyStr = req.body;
    } else {
      rawBodyStr = JSON.stringify(req.body || {});
    }

    if (secret) {
      try {
        const hmac = crypto.createHmac("sha256", secret).update(rawBodyStr).digest("hex");
        if (!sigHeader || sigHeader !== hmac) {
          const errorResponse = { error: "Invalid webhook signature" };
          await apiLogger.logWebhookResponse(requestId, 401, errorResponse, false, 'Invalid signature');
          return res.status(401).json(errorResponse);
        }
      } catch (e) {
        const errorResponse = { error: "Webhook signature verification failed" };
        await apiLogger.logWebhookResponse(requestId, 401, errorResponse, false, e.message);
        return res.status(401).json(errorResponse);
      }
    }

    // Parse payload after signature verification
    let payload;
    try {
      payload = typeof rawBodyStr === "string" && rawBodyStr.length ? JSON.parse(rawBodyStr) : req.body;
    } catch (e) {
      const errorResponse = { error: "Invalid JSON payload" };
      await apiLogger.logWebhookResponse(requestId, 400, errorResponse, false, 'Invalid JSON');
      return res.status(400).json(errorResponse);
    }

    const { request_id, request_status, actions } = payload || {};

    // Find contract by Zoho Sign request ID
    const contract = await Contract.findOne({ zohoSignRequestId: request_id });
    if (!contract) {
      console.log(`Webhook received for unknown request_id: ${request_id}`);
      return res.status(200).json({ message: "Webhook received" });
    }

    // Update contract status based on webhook data
    let newStatus = contract.status;
    let updateData = {};

    if (request_status === "completed") {
      newStatus = "active";
      updateData.signedAt = new Date();
      try {
        const loggedZohoSign = new LoggedZohoSign();
        const signedDocumentUrl = await loggedZohoSign.downloadSignedDocument(request_id);
        updateData.fileUrl = signedDocumentUrl;
        console.log(`Downloaded signed document for contract ${contract._id}: ${signedDocumentUrl}`);
      } catch (downloadError) {
        console.error(`Failed to download signed document for contract ${contract._id}:`, downloadError);
      }
    } else if (request_status === "declined") {
      newStatus = "draft"; 
      updateData.declinedAt = new Date();
    }

    if (newStatus !== contract.status) {
      updateData.status = newStatus;
      await Contract.findByIdAndUpdate(contract._id, updateData);
      console.log(`Contract ${contract._id} status updated to: ${newStatus}`);

      // Auto-create invoice when contract becomes active via Zoho Sign
      if (newStatus === "active") {
        try {
          const invoice = await createInvoiceFromContract(contract._id, {
            issueOn: "activation",
            prorate: true,
            dueDays: 7
          });
          console.log(`Auto-created invoice ${invoice._id} for contract ${contract._id} via Zoho Sign webhook`);
        } catch (invoiceError) {
          console.error("Failed to auto-create invoice from webhook:", invoiceError);
          // Don't fail the webhook processing if invoice creation fails
        }
      }
    }

    const response = { message: "Webhook processed successfully" };
    await apiLogger.logWebhookResponse(requestId, 200, response, true);
    
    return res.status(200).json(response);
  } catch (err) {
    console.error("handleZohoSignWebhook error:", err);
    await logErrorActivity(req, err, 'Zoho Sign Webhook');
    
    const errorResponse = { error: "Webhook processing failed" };
    await apiLogger.logWebhookResponse(requestId, 500, errorResponse, false, err.message);
    
    return res.status(500).json(errorResponse);
  }
};

// Helper function: Create document in Zoho Sign
async function createZohoSignDocument(contract) {
  const formData = new FormData();

  let fileBuffer = null;
  let fileName = `contract_${contract._id || 'doc'}.pdf`;
  try {
    if (contract.fileUrl) {
      // Download actual file to ensure Zoho gets a valid PDF
      const fileResp = await fetch(contract.fileUrl);
      if (!fileResp.ok) {
        throw new Error(`Failed to download fileUrl: HTTP ${fileResp.status}`);
      }
      fileBuffer = Buffer.from(await fileResp.arrayBuffer());
      // Try to infer a filename from the URL
      const urlName = (contract.fileUrl.split('?')[0] || '').split('/').pop();
      if (urlName) fileName = urlName;
    } else {
      // Fallback to placeholder content
      fileBuffer = await generateContractPDFBuffer(contract);
    }
  } catch (e) {
    console.warn('Falling back to generated PDF due to download error:', e?.message);
    fileBuffer = await generateContractPDFBuffer(contract);
  }

  formData.append('file', fileBuffer, fileName);
  // Zoho Sign expects the JSON to be wrapped under a top-level 'requests' key
  formData.append('data', JSON.stringify({
    requests: {
      request_name: `Contract for ${contract.client.companyName}`,
      expiration_days: 30,
      is_sequential: true
    }
  }));
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests`, {
    method: 'POST',
    headers: {
      ...(typeof formData.getHeaders === 'function' ? formData.getHeaders() : {}),
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    },
    body: formData
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Zoho Sign API error";
    console.error("Zoho Sign create error payload:", result);
    throw new Error(`Zoho Sign API error: ${msg}`);
  }
  
  // Return only the request_id to avoid shape confusion
  return result.requests?.request_id;
}

// Helper function: Add recipient to document
async function addRecipientToDocument(requestId, client, documentId) {
  // Zoho Sign expects actions under requests.actions and page_no starts at 1
  const actionData = {
    requests: {
      actions: [{
        action_type: "SIGN",
        recipient_name: client.contactPerson,
        recipient_email: client.email,
        signing_order: 1,
        fields: [{
          field_type_name: "Signature",
          document_id: documentId,
          page_no: 1,
          x_coord: 100,
          y_coord: 200,
          width: 150,
          height: 50,
          is_mandatory: true
        }]
      }]
    }
  };

  const accessToken = await getAccessToken();
  // Retry up to 3 times to handle eventual consistency after create
  const maxRetries = 3;
  let lastErrorResult = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(actionData)
    });

    const result = await response.json();
    if (result.status === "success") {
      return result;
    }

    lastErrorResult = result;
    const msg = result.message || "Failed to add recipient";
    // If document not yet available, wait briefly and retry
    if (typeof msg === 'string' && msg.toLowerCase().includes('document does not exist') && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 600));
      continue;
    }
    console.error("Zoho Sign addRecipient error payload:", { requestId, result, attempt });
    throw new Error(`Failed to add recipient: ${msg}`);
  }
  console.error("Zoho Sign addRecipient final failure:", { requestId, lastErrorResult });
  const finalMsg = lastErrorResult?.message || "Failed to add recipient";
  throw new Error(`Failed to add recipient: ${finalMsg}`);
}

// Helper function: Submit document for signature
async function submitDocumentForSignature(requestId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    // Zoho Sign submit API expects a top-level 'requests' object in body, but not 'request_id'.
    // Sending request_id causes: code 9043 (Extra key found), while omitting 'requests' causes code 9008.
    body: JSON.stringify({ requests: {} })
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to submit document";
    console.error("Zoho Sign submit error payload:", { requestId, result });
    throw new Error(`Failed to submit document: ${msg}`);
  }
  
  return result;
}

// Helper function: Verify document exists before adding recipients
async function verifyDocumentExists(requestId) {
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const accessToken = await getAccessToken();
      const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      const result = await response.json();
      // Fail fast on OAuth scope issues instead of retrying
      const msgStr = (result && (result.message || result.code)) ? String(result.message || result.code) : "";
      if (result?.code === 9040 || /invalid oauth scope/i.test(msgStr)) {
        const guidance = "Zoho Sign returned 'Invalid Oauth Scope'. Ensure your refresh token has Zoho Sign scopes and that ZOHO_SIGN_REFRESH_TOKEN is used. Minimum recommended scopes: ZohoSign.documents.ALL, ZohoSign.requests.ALL, ZohoSign.organization.READ.";
        console.error("Zoho Sign scope error while verifying document:", { result, guidance });
        throw new Error(guidance);
      }
      if (result.status === "success" && result.requests) {
        console.log(`Document ${requestId} verified on attempt ${attempt}`);
        return result.requests;
      }
      
      console.log(`Document ${requestId} not ready, attempt ${attempt}/${maxRetries}:`, result);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1 second
      }
    } catch (error) {
      console.error(`Error verifying document ${requestId}, attempt ${attempt}:`, error);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  throw new Error(`Document ${requestId} not available after ${maxRetries} attempts`);
}

// Helper function: Get document status from Zoho Sign
async function getZohoSignDocumentStatus(requestId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    }
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to get document status";
    throw new Error(`Failed to get document status: ${msg}`);
  }
  
  return result.requests;
}

// Helper function: Download signed document from Zoho Sign
async function downloadSignedDocument(requestId) {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}/pdf`, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download signed document: HTTP ${response.status}`);
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    
    // Upload to ImageKit
    const fileName = `signed_contract_${requestId}_${Date.now()}.pdf`;
    const uploadResponse = await imagekit.upload({
      file: pdfBuffer,
      fileName: fileName,
      folder: "/contracts/signed"
    });

    return uploadResponse.url;
  } catch (error) {
    console.error("Failed to download and upload signed document:", error);
    throw error;
  }
}

// Generate contract PDF using template
export const generateContractPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const contractData = {
      companyName: contract.client.companyName,
      contactPerson: contract.client.contactPerson,
      email: contract.client.email,
      phone: contract.client.phone,
      companyAddress: contract.client.companyAddress,
      buildingName: contract.building?.name || "TBD",
      buildingAddress: contract.building?.address || "TBD",
      capacity: contract.capacity || 4,
      monthlyRent: contract.monthlyRent || 15000,
      contractStartDate: contract.startDate ? contract.startDate.toLocaleDateString() : new Date().toLocaleDateString(),
      contractEndDate: contract.endDate ? contract.endDate.toLocaleDateString() : new Date(Date.now() + 365*24*60*60*1000).toLocaleDateString(),
      terms: contract.terms || ""
    };

    const docDefinition = getContractTemplate(contractData);

    // Create PDF with built-in fonts (no external files needed)
    const fonts = getFonts();
    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contract_${contract.client.companyName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    
    // Update contract fileUrl with the download URL before streaming
    if (contract.status === 'draft' && !contract.fileUrl) {
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/contracts/${id}/download-pdf`;
      await Contract.findByIdAndUpdate(id, { fileUrl: downloadUrl });
    }

    // Stream PDF to response with error handling
    pdfDoc.on("error", (err) => {
      console.error("PDF stream error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to generate contract PDF" });
      }
    });
    pdfDoc.pipe(res);
    pdfDoc.end();

  } catch (error) {
    console.error("Generate contract PDF error:", error);
    return res.status(500).json({ error: "Failed to generate contract PDF" });
  }
};

// Helper function: Generate contract PDF buffer for Zoho Sign
function generateContractPDFBuffer(contract) {
  try {
    const contractData = {
      companyName: contract.client.companyName,
      contactPerson: contract.client.contactPerson,
      email: contract.client.email,
      phone: contract.client.phone,
      companyAddress: contract.client.companyAddress,
      buildingName: contract.building?.name || "TBD",
      buildingAddress: contract.building?.address || "TBD",
      capacity: contract.capacity || 4,
      monthlyRent: contract.monthlyRent || 15000,
      securityDeposit: contract.securityDeposit || 30000,
      contractStartDate: contract.startDate ? contract.startDate.toLocaleDateString() : new Date().toLocaleDateString(),
      contractEndDate: contract.endDate ? contract.endDate.toLocaleDateString() : new Date(Date.now() + 365*24*60*60*1000).toLocaleDateString(),
      terms: contract.terms || ""
    };

    const docDefinition = getContractTemplate(contractData);

    const fonts = getFonts();
    const printer = new PdfPrinter(fonts);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    const chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    
    return new Promise((resolve, reject) => {
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  } catch (error) {
    console.error("Generate contract PDF buffer error:", error);
    // Fallback to simple text
    const contractText = `
CONTRACT AGREEMENT

Client: ${contract.client.companyName}
Contact: ${contract.client.contactPerson}
Email: ${contract.client.email}

Start Date: ${contract.startDate ? contract.startDate.toDateString() : 'TBD'}
End Date: ${contract.endDate ? contract.endDate.toDateString() : 'TBD'}

Terms and Conditions:
[Contract terms would go here]

Signature: ___________________
Date: ___________________
`;
  
  return Buffer.from(contractText, 'utf8');
}
}

// Helper: configure fonts for pdfmake in Node.js (use default fonts to avoid filesystem issues)
function getFonts() {
  // Use built-in fonts that don't require external files
  return {
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique'
    }
  };
}
