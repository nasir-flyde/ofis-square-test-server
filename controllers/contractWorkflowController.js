import Contract from "../models/contractModel.js";
import { logContractActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";

// Submit contract to Legal (Sales → Legal)
export const submitToLegal = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "draft") {
      return res.status(400).json({ 
        success: false, 
        message: `Only draft contracts can be submitted to legal. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "submitted_to_legal";
    contract.submittedToLegalBy = req.user?._id || null;
    contract.submittedToLegalAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SUBMITTED_TO_LEGAL', 'Contract', id, {
      submittedBy: req.user?._id,
      previousStatus: "draft"
    });
    
    // TODO: Send notification to Legal team
    
    return res.json({ 
      success: true,
      message: "Contract submitted to Legal team for review",
      contract
    });
  } catch (err) {
    console.error("submitToLegal error:", err);
    await logErrorActivity(req, err, 'Submit Contract to Legal');
    return res.status(500).json({ success: false, message: "Failed to submit contract to legal" });
  }
};

// Submit contract to Admin (Legal → Admin)
export const submitToAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    const validStatuses = ["submitted_to_legal", "legal_reviewed", "draft"];
    if (!validStatuses.includes(contract.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot submit to admin from status: ${contract.status}` 
      });
    }
    
    contract.status = "pending_admin_approval";
    contract.submittedToAdminBy = req.user?._id || null;
    contract.submittedToAdminAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SUBMITTED_TO_ADMIN', 'Contract', id, {
      submittedBy: req.user?._id,
      previousStatus: contract.status
    });
    
    // TODO: Send notification to Admin (Senior Management)
    
    return res.json({ 
      success: true,
      message: "Contract submitted to Admin for approval",
      contract
    });
  } catch (err) {
    console.error("submitToAdmin error:", err);
    await logErrorActivity(req, err, 'Submit Contract to Admin');
    return res.status(500).json({ success: false, message: "Failed to submit contract to admin" });
  }
};

// Admin approves contract
export const adminApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalType, conditions } = req.body || {};
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "pending_admin_approval") {
      return res.status(400).json({ 
        success: false, 
        message: `Only contracts pending admin approval can be approved. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "admin_approved";
    contract.adminApprovedBy = req.user?._id || null;
    contract.adminApprovedAt = new Date();
    contract.approvalType = approvalType || "full";
    if (conditions) {
      contract.approvalConditions = conditions;
    }
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_ADMIN_APPROVED', 'Contract', id, {
      approvedBy: req.user?._id,
      approvalType: contract.approvalType,
      conditions: conditions,
      previousStatus: "pending_admin_approval"
    });
    
    // TODO: Send notification to Legal team to proceed
    
    return res.json({ 
      success: true,
      message: `Contract approved by Admin${approvalType === 'partial' ? ' (partial approval)' : ''}`,
      contract
    });
  } catch (err) {
    console.error("adminApprove error:", err);
    await logErrorActivity(req, err, 'Admin Approve Contract');
    return res.status(500).json({ success: false, message: "Failed to approve contract" });
  }
};

// Admin rejects contract
export const adminReject = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    
    if (!reason || reason.trim() === "") {
      return res.status(400).json({ 
        success: false, 
        message: "Rejection reason is required" 
      });
    }
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "pending_admin_approval") {
      return res.status(400).json({ 
        success: false, 
        message: `Only contracts pending admin approval can be rejected. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "draft"; // Return to draft for revision
    contract.adminRejectedBy = req.user?._id || null;
    contract.adminRejectedAt = new Date();
    contract.adminRejectionReason = reason;
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    // Add comment
    contract.comments.push({
      by: req.user?._id || null,
      type: "review",
      message: `Admin rejected: ${reason}`
    });
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_ADMIN_REJECTED', 'Contract', id, {
      rejectedBy: req.user?._id,
      rejectionReason: reason,
      previousStatus: "pending_admin_approval"
    });
    
    // TODO: Send notification to Sales and Legal
    
    return res.json({ 
      success: true,
      message: "Contract rejected and returned to draft",
      contract
    });
  } catch (err) {
    console.error("adminReject error:", err);
    await logErrorActivity(req, err, 'Admin Reject Contract');
    return res.status(500).json({ success: false, message: "Failed to reject contract" });
  }
};

// Send contract to client for review (Legal → Client)
export const sendToClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { clientEmail } = req.body || {};
    
    const contract = await Contract.findById(id).populate("client");
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "admin_approved") {
      return res.status(400).json({ 
        success: false, 
        message: `Only admin-approved contracts can be sent to client. Current status: ${contract.status}` 
      });
    }
    
    const emailToUse = clientEmail || contract.client?.email;
    if (!emailToUse) {
      return res.status(400).json({ 
        success: false, 
        message: "Client email is required" 
      });
    }
    
    contract.status = "sent_to_client";
    contract.sentToClientBy = req.user?._id || null;
    contract.sentToClientAt = new Date();
    contract.clientEmail = emailToUse;
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SENT_TO_CLIENT', 'Contract', id, {
      sentBy: req.user?._id,
      clientEmail: emailToUse,
      previousStatus: "admin_approved"
    });
    
    // TODO: Send email to client with agreement for review
    
    return res.json({ 
      success: true,
      message: "Contract sent to client for review",
      contract
    });
  } catch (err) {
    console.error("sendToClient error:", err);
    await logErrorActivity(req, err, 'Send Contract to Client');
    return res.status(500).json({ success: false, message: "Failed to send contract to client" });
  }
};

// Mark client as approved
export const markClientApproved = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "sent_to_client") {
      return res.status(400).json({ 
        success: false, 
        message: `Can only mark contracts sent to client as approved. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "client_approved";
    contract.clientApprovedAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_CLIENT_APPROVED', 'Contract', id, {
      markedBy: req.user?._id,
      previousStatus: "sent_to_client"
    });
    
    // TODO: Notify Legal to proceed with stamp paper
    
    return res.json({ 
      success: true,
      message: "Contract marked as client approved",
      contract
    });
  } catch (err) {
    console.error("markClientApproved error:", err);
    await logErrorActivity(req, err, 'Mark Client Approved');
    return res.status(500).json({ success: false, message: "Failed to mark client approved" });
  }
};

// Record client feedback
export const recordClientFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body || {};
    
    if (!feedback || feedback.trim() === "") {
      return res.status(400).json({ 
        success: false, 
        message: "Feedback is required" 
      });
    }
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "sent_to_client") {
      return res.status(400).json({ 
        success: false, 
        message: `Can only record feedback for contracts sent to client. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "draft"; // Return to draft for revision
    contract.clientFeedback = feedback;
    contract.clientFeedbackAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    // Add comment
    contract.comments.push({
      by: req.user?._id || null,
      type: "client",
      message: `Client feedback: ${feedback}`
    });
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_CLIENT_FEEDBACK', 'Contract', id, {
      feedback: feedback,
      previousStatus: "sent_to_client"
    });
    
    // TODO: Notify Sales and Legal about client feedback
    
    return res.json({ 
      success: true,
      message: "Client feedback recorded, contract returned to draft",
      contract
    });
  } catch (err) {
    console.error("recordClientFeedback error:", err);
    await logErrorActivity(req, err, 'Record Client Feedback');
    return res.status(500).json({ success: false, message: "Failed to record client feedback" });
  }
};

// Generate stamp paper version
export const generateStampPaper = async (req, res) => {
  try {
    const { id } = req.params;
    const uploadedFile = req.file;
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "client_approved") {
      return res.status(400).json({ 
        success: false, 
        message: `Can only generate stamp paper for client-approved contracts. Current status: ${contract.status}` 
      });
    }
    
    if (!uploadedFile) {
      return res.status(400).json({ 
        success: false, 
        message: "Stamp paper file is required" 
      });
    }
    
    // Upload to ImageKit
    let stampPaperUrl;
    try {
      const fileName = `stamp_paper_${id}_${Date.now()}_${uploadedFile.originalname}`;
      const uploadResponse = await imagekit.upload({
        file: uploadedFile.buffer,
        fileName: fileName,
        folder: "/contracts/stamp-papers"
      });
      
      stampPaperUrl = uploadResponse.url;
    } catch (uploadErr) {
      console.error("ImageKit upload error:", uploadErr);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to upload stamp paper to ImageKit" 
      });
    }
    
    contract.status = "stamp_paper_ready";
    contract.stampPaperUrl = stampPaperUrl;
    contract.stampPaperGeneratedAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_STAMP_PAPER_GENERATED', 'Contract', id, {
      generatedBy: req.user?._id,
      stampPaperUrl: stampPaperUrl,
      previousStatus: "client_approved"
    });
    
    return res.json({ 
      success: true,
      message: "Stamp paper version generated",
      contract
    });
  } catch (err) {
    console.error("generateStampPaper error:", err);
    await logErrorActivity(req, err, 'Generate Stamp Paper');
    return res.status(500).json({ success: false, message: "Failed to generate stamp paper" });
  }
};

// Send for e-signature (Zoho Sign)
export const sendForESignature = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "stamp_paper_ready") {
      return res.status(400).json({ 
        success: false, 
        message: `Can only send stamp paper contracts for signature. Current status: ${contract.status}` 
      });
    }
    
    if (!contract.stampPaperUrl) {
      return res.status(400).json({ 
        success: false, 
        message: "Stamp paper URL is required before sending for signature" 
      });
    }
    
    // TODO: Integrate with Zoho Sign API
    // For now, just update status
    const envelopeId = `ZOHO_${Date.now()}_${contract._id}`;
    
    contract.status = "sent_for_signature";
    contract.signatureProvider = "zoho_sign";
    contract.signatureEnvelopeId = envelopeId;
    contract.sentForSignatureAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', 'Contract', id, {
      sentBy: req.user?._id,
      signatureProvider: "zoho_sign",
      envelopeId: envelopeId,
      previousStatus: "stamp_paper_ready"
    });
    
    // TODO: Send notification to client and sales
    
    return res.json({ 
      success: true,
      message: "Contract sent for e-signature via Zoho Sign",
      contract,
      envelopeId
    });
  } catch (err) {
    console.error("sendForESignature error:", err);
    await logErrorActivity(req, err, 'Send for E-Signature');
    return res.status(500).json({ success: false, message: "Failed to send for e-signature" });
  }
};

// Mark contract as signed (called by webhook or manually)
export const markSigned = async (req, res) => {
  try {
    const { id } = req.params;
    const { signedBy } = req.body || {};
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    if (contract.status !== "sent_for_signature") {
      return res.status(400).json({ 
        success: false, 
        message: `Can only mark contracts sent for signature as signed. Current status: ${contract.status}` 
      });
    }
    
    contract.status = "signed";
    contract.signedAt = new Date();
    contract.signedBy = signedBy || contract.client?.companyName || "Client";
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SIGNED', 'Contract', id, {
      signedBy: signedBy,
      previousStatus: "sent_for_signature"
    });
    
    // TODO: Notify Finance and Operations for next steps
    
    return res.json({ 
      success: true,
      message: "Contract marked as signed",
      contract
    });
  } catch (err) {
    console.error("markSigned error:", err);
    await logErrorActivity(req, err, 'Mark Contract Signed');
    return res.status(500).json({ success: false, message: "Failed to mark contract as signed" });
  }
};

// Add comment to contract
export const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, type } = req.body || {};
    
    if (!message || message.trim() === "") {
      return res.status(400).json({ 
        success: false, 
        message: "Comment message is required" 
      });
    }
    
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found" });
    }
    
    const commentType = type || "internal";
    if (!["review", "internal", "client"].includes(commentType)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid comment type. Must be: review, internal, or client" 
      });
    }
    
    contract.comments.push({
      by: req.user?._id || null,
      type: commentType,
      message: message.trim()
    });
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_COMMENT_ADDED', 'Contract', id, {
      commentBy: req.user?._id,
      commentType: commentType,
      message: message.trim()
    });
    
    return res.json({ 
      success: true,
      message: "Comment added to contract",
      contract
    });
  } catch (err) {
    console.error("addComment error:", err);
    await logErrorActivity(req, err, 'Add Contract Comment');
    return res.status(500).json({ success: false, message: "Failed to add comment" });
  }
};

// Get contracts by status (for dashboard filtering)
export const getContractsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    
    const validStatuses = [
      "draft", "submitted_to_legal", "legal_reviewed", "pending_admin_approval",
      "admin_approved", "admin_rejected", "sent_to_client", "client_approved",
      "client_feedback_pending", "stamp_paper_ready", "sent_for_signature", "signed", "active"
    ];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` 
      });
    }
    
    const contracts = await Contract.find({ status })
      .populate("client", "companyName email contactPerson phone")
      .populate("building", "name address pricing")
      .populate("createdBy", "name email")
      .populate("submittedToLegalBy", "name email")
      .populate("submittedToAdminBy", "name email")
      .populate("adminApprovedBy", "name email")
      .populate("adminRejectedBy", "name email")
      .sort({ lastActionAt: -1, createdAt: -1 });
    
    return res.json({ 
      success: true, 
      data: contracts,
      count: contracts.length
    });
  } catch (err) {
    console.error("getContractsByStatus error:", err);
    await logErrorActivity(req, err, 'Get Contracts by Status');
    return res.status(500).json({ success: false, message: "Failed to fetch contracts" });
  }
};
