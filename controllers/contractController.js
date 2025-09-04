import mongoose from "mongoose";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import crypto from "crypto";
import { getAccessToken } from "../utils/zohoSignAuth.js";
import imagekit from "../utils/imageKit.js";

// Zoho Sign API configuration
const ZOHO_SIGN_BASE_URL = "https://sign.zoho.com/api/v1";

// Get all contracts
export const getContracts = async (req, res) => {
  try {
    const contracts = await Contract.find()
      .populate("client", "companyName email contactPerson")
      .sort({ createdAt: -1 });
    return res.json(contracts);
  } catch (err) {
    console.error("getContracts error:", err);
    return res.status(500).json({ error: "Failed to fetch contracts" });
  }
};

// Get contract by ID
export const getContractById = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id).populate("client");
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    return res.json(contract);
  } catch (err) {
    console.error("getContractById error:", err);
    return res.status(500).json({ error: "Failed to fetch contract" });
  }
};

// Send contract for digital signature
export const sendForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id).populate("client");
    
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (contract.status !== "draft") {
      return res.status(400).json({ error: "Only draft contracts can be sent for signature" });
    }
    if (!contract.client) return res.status(400).json({ error: "Contract client not found" });

    // Step 1: Create document in Zoho Sign
    const documentData = await createZohoSignDocument(contract);
    
    // Step 2: Add recipient and signature fields
    await addRecipientToDocument(documentData.request_id, contract.client);
    
    // Step 3: Submit document for signature
    await submitDocumentForSignature(documentData.request_id);
    
    // Update contract status and store Zoho Sign request ID
    const updatedContract = await Contract.findByIdAndUpdate(
      id,
      { 
        status: "pending_signature",
        zohoSignRequestId: documentData.request_id,
        sentForSignatureAt: new Date()
      },
      { new: true }
    );

    return res.json({ 
      message: "Contract sent for digital signature", 
      contract: updatedContract,
      zohoSignRequestId: documentData.request_id
    });
  } catch (err) {
    console.error("sendForSignature error:", err);
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

    const status = await getZohoSignDocumentStatus(contract.zohoSignRequestId);
    
    // Update contract status based on Zoho Sign status
    let newStatus = contract.status;
    if (status.request_status === "completed") {
      newStatus = "active";
      await Contract.findByIdAndUpdate(id, { 
        status: "active",
        signedAt: new Date()
      });
    }

    return res.json({ 
      contractStatus: newStatus,
      zohoSignStatus: status.request_status,
      signatureDetails: status
    });
  } catch (err) {
    console.error("checkSignatureStatus error:", err);
    return res.status(500).json({ error: "Failed to check signature status" });
  }
};

// Frontdesk/manual: upload a signed contract file or provide a fileUrl and mark as active
export const uploadSignedContract = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id).populate("client");
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

    return res.status(200).json({
      message: "Contract marked as active with uploaded signed file",
      contract,
    });
  } catch (err) {
    console.error("uploadSignedContract error:", err);
    return res.status(500).json({ error: "Failed to upload signed contract" });
  }
};

// Webhook handler for Zoho Sign events
export const handleZohoSignWebhook = async (req, res) => {
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
          return res.status(401).json({ error: "Invalid webhook signature" });
        }
      } catch (e) {
        return res.status(401).json({ error: "Webhook signature verification failed" });
      }
    }

    // Parse payload after signature verification
    let payload;
    try {
      payload = typeof rawBodyStr === "string" && rawBodyStr.length ? JSON.parse(rawBodyStr) : req.body;
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON payload" });
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
    } else if (request_status === "declined") {
      newStatus = "draft"; // Reset to draft for re-sending
      updateData.declinedAt = new Date();
    }

    if (newStatus !== contract.status) {
      updateData.status = newStatus;
      await Contract.findByIdAndUpdate(contract._id, updateData);
      console.log(`Contract ${contract._id} status updated to: ${newStatus}`);
    }

    return res.status(200).json({ message: "Webhook processed successfully" });
  } catch (err) {
    console.error("handleZohoSignWebhook error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Helper function: Create document in Zoho Sign
async function createZohoSignDocument(contract) {
  const formData = new FormData();
  
  // For now, create a simple contract document
  // In production, you'd generate a proper PDF contract
  const contractContent = generateContractPDF(contract);
  formData.append('file', contractContent, 'contract.pdf');
  formData.append('data', JSON.stringify({
    request_name: `Contract for ${contract.client.companyName}`,
    expiration_days: 30,
    is_sequential: true
  }));
  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests`, {
    method: 'POST',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    },
    body: formData
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Zoho Sign API error";
    throw new Error(`Zoho Sign API error: ${msg}`);
  }
  
  return result.requests;
}

// Helper function: Add recipient to document
async function addRecipientToDocument(requestId, client) {
  const actionData = {
    actions: [{
      action_type: "SIGN",
      recipient_name: client.contactPerson,
      recipient_email: client.email,
      signing_order: 1,
      fields: [{
        field_type_name: "Signature",
        page_no: 0,
        x_coord: 100,
        y_coord: 200,
        width: 150,
        height: 50,
        is_mandatory: true
      }]
    }]
  };

  const accessToken = await getAccessToken();
  const response = await fetch(`${ZOHO_SIGN_BASE_URL}/requests/${requestId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(actionData)
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to add recipient";
    throw new Error(`Failed to add recipient: ${msg}`);
  }
  
  return result;
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
    body: JSON.stringify({ request_id: requestId })
  });

  const result = await response.json();
  if (result.status !== "success") {
    const msg = result.message || "Failed to submit document";
    throw new Error(`Failed to submit document: ${msg}`);
  }
  
  return result;
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

// Helper function: Generate contract PDF (placeholder)
function generateContractPDF(contract) {
  // This is a placeholder - in production you'd use a PDF library
  // to generate a proper contract document
  const contractText = `
CONTRACT AGREEMENT

Client: ${contract.client.companyName}
Contact: ${contract.client.contactPerson}
Email: ${contract.client.email}

Start Date: ${contract.startDate.toDateString()}
End Date: ${contract.endDate.toDateString()}

Terms and Conditions:
[Contract terms would go here]

Signature: ___________________
Date: ___________________
  `;
  
  return Buffer.from(contractText, 'utf8');
}
