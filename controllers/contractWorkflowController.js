import Contract from "../models/contractModel.js";
import { logContractActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import {
  sendAdminApprovalRequestEmail,
  sendAdminApprovalConfirmationEmail,
  sendClientReviewRequestEmail,
  sendLegalReviewRequestEmail,
  sendContractCommentEmail,
  sendContractSentForSignatureEmail,
  sendContractSignedEmail
} from "../utils/contractEmailService.js";

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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      submittedBy: req.user?._id,
      previousStatus: "draft",
      action: 'submitted_to_legal'
    });
    
    // Send email notification to Legal team
    const populatedContract = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendLegalReviewRequestEmail(populatedContract);
    
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      submittedBy: req.user?._id,
      previousStatus: contract.status,
      action: 'submitted_to_admin'
    });
    
    // Send email notification to Admin (Senior Management)
    const populatedContract = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendAdminApprovalRequestEmail(populatedContract);
    
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      approvedBy: req.user?._id,
      approvalType: contract.approvalType,
      conditions: conditions,
      previousStatus: "pending_admin_approval",
      action: 'admin_approved'
    });
    
    // Send email notification to Sales, Legal team, and Admins
    const populatedContract = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendAdminApprovalConfirmationEmail(populatedContract);
    
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      rejectedBy: req.user?._id,
      rejectionReason: reason,
      previousStatus: "pending_admin_approval",
      action: 'admin_rejected'
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
    
    // Allow sending to client from admin_approved or client_feedback_pending (re-send after addressing feedback)
    const validStatuses = ["admin_approved", "client_feedback_pending"];
    if (!validStatuses.includes(contract.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Only admin-approved contracts or contracts with pending feedback can be sent to client. Current status: ${contract.status}` 
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client._id, {
      sentBy: req.user?._id,
      clientEmail: emailToUse,
      previousStatus: contract.status === "client_feedback_pending" ? "client_feedback_pending" : "admin_approved",
      isResend: contract.status === "client_feedback_pending",
      action: 'sent_to_client'
    });
    
    // Send email to client with agreement for review
    const populatedContract = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendClientReviewRequestEmail(populatedContract, emailToUse);
    
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      markedBy: req.user?._id,
      previousStatus: "sent_to_client",
      action: 'client_approved'
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
    
    // Allow feedback for draft, sent_to_client, or client_feedback_pending contracts
    const validStatuses = ["draft", "sent_to_client", "client_feedback_pending"];
    if (!validStatuses.includes(contract.status)) {
      return res.status(400).json({
        success: false,
        message: `Can only record feedback for draft, sent to client, or feedback pending contracts. Current status: ${contract.status}`
      });
    }
    
    // Handle file uploads if present
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileName = `feedback_${id}_${Date.now()}_${file.originalname}`;
          const uploadResponse = await imagekit.upload({
            file: file.buffer,
            fileName: fileName,
            folder: "/contracts/feedback"
          });
          
          uploadedFiles.push({
            fileName: file.originalname,
            fileUrl: uploadResponse.url,
            uploadedAt: new Date()
          });
        } catch (uploadErr) {
          console.error("File upload error:", uploadErr);
          // Continue with other files even if one fails
        }
      }
    }
    
    // Keep current status, just update feedback
    contract.clientFeedback = feedback;
    contract.clientFeedbackAt = new Date();
    
    // Add uploaded files to feedback attachments
    if (uploadedFiles.length > 0) {
      if (!contract.clientFeedbackAttachments) {
        contract.clientFeedbackAttachments = [];
      }
      contract.clientFeedbackAttachments.push(...uploadedFiles);
    }
    
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    contract.version += 1;
    
    // Add comment
    const attachmentInfo = uploadedFiles.length > 0 
      ? ` (${uploadedFiles.length} attachment${uploadedFiles.length > 1 ? 's' : ''})` 
      : '';
    contract.comments.push({
      by: req.user?._id || null,
      type: "client",
      message: `Client feedback: ${feedback}${attachmentInfo}`
    });
    
    await contract.save();
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      feedback: feedback,
      attachmentsCount: uploadedFiles.length,
      previousStatus: contract.status,
      action: 'client_feedback'
    });
    
    // Send email notification to stakeholders
    try {
      const populatedContract = await Contract.findById(id)
        .populate('client', 'companyName')
        .populate('building', 'name');
      const { sendClientFeedbackAlertEmail } = await import('../utils/contractEmailService.js');
      await sendClientFeedbackAlertEmail(populatedContract, feedback);
    } catch (emailErr) {
      console.error('Failed to send feedback notification email:', emailErr);
      // Don't fail the request if email fails
    }
    
    return res.json({
      success: true,
      message: "Client feedback recorded successfully",
      contract,
      attachmentsUploaded: uploadedFiles.length
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
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      generatedBy: req.user?._id,
      stampPaperUrl: stampPaperUrl,
      previousStatus: "client_approved",
      action: 'stamp_paper_generated'
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
    
    console.log('Sending contract for signature via Zoho Sign:', {
      contractId: contract._id,
      clientName: contract.client.companyName,
      stampPaperUrl: contract.stampPaperUrl,
      status: contract.status
    });
    const { default: loggedZohoSign } = await import('../utils/loggedZohoSign.js');
    
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
    contract.status = "sent_for_signature";
    contract.signatureProvider = "zoho_sign";
    contract.signatureEnvelopeId = requestId;
    contract.zohoSignRequestId = requestId;
    contract.sentForSignatureAt = new Date();
    contract.lastActionBy = req.user?._id || null;
    contract.lastActionAt = new Date();
    
    await contract.save();
    
    await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', id, contract.client, {
      sentBy: req.user?._id,
      signatureProvider: "zoho_sign",
      envelopeId: requestId,
      zohoSignRequestId: requestId,
      previousStatus: "stamp_paper_ready"
    });
    
    // Send email notification to stakeholders (Sales + Legal + Admins)
    const populatedContractForEmail = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendContractSentForSignatureEmail(populatedContractForEmail);
    
    return res.json({ 
      success: true,
      message: "Contract sent for e-signature via Zoho Sign",
      contract,
      zohoSignRequestId: requestId
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
    
    await logContractActivity(req, 'CONTRACT_SIGNED', id, contract.client, {
      signedBy: signedBy,
      previousStatus: "sent_for_signature"
    });
    
    // Send email notification to stakeholders (Sales + Legal + Admins)
    const populatedContractForEmail = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    await sendContractSignedEmail(populatedContractForEmail);
    
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
    const { message, type, mentionedUsers } = req.body || {};
    
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
    if (!["review", "internal", "client", "legal_only"].includes(commentType)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid comment type. Must be: review, internal, client, or legal_only" 
      });
    }
    
    // Validate legal_only access
    if (commentType === 'legal_only') {
      const User = (await import('../models/userModel.js')).default;
      const Role = (await import('../models/roleModel.js')).default;
      
      const userWithRole = await User.findById(req.user?._id).populate('role', 'roleName');
      const userRole = userWithRole?.role?.roleName;
      
      if (!['Legal Team', 'System Admin'].includes(userRole)) {
        return res.status(403).json({ 
          success: false, 
          message: "Only Legal Team and System Admin can add legal_only comments" 
        });
      }
    }
    
    // Validate mentionedUsers if provided
    const validMentionedUsers = Array.isArray(mentionedUsers) ? mentionedUsers.filter(id => id) : [];
    
    contract.comments.push({
      by: req.user?._id || null,
      type: commentType,
      message: message.trim(),
      mentionedUsers: validMentionedUsers
    });
    
    await contract.save();
    
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      commentBy: req.user?._id,
      commentType: commentType,
      message: message.trim(),
      mentionedUsersCount: validMentionedUsers.length,
      action: 'comment_added'
    });
    
    // Send targeted email notifications
    const populatedContract = await Contract.findById(id)
      .populate('client', 'companyName')
      .populate('building', 'name');
    const addedByName = req.user?.name || 'Unknown User';
    
    if (commentType === 'internal' && validMentionedUsers.length > 0) {
      // Send email only to mentioned users for internal comments
      const User = (await import('../models/userModel.js')).default;
      const mentionedUserDocs = await User.find({ _id: { $in: validMentionedUsers } }).select('name email');
      
      for (const user of mentionedUserDocs) {
        try {
          await sendContractCommentEmail(populatedContract, message.trim(), addedByName, user.email, user.name);
        } catch (emailErr) {
          console.error(`Failed to send email to ${user.email}:`, emailErr);
        }
      }
    } else if (commentType === 'legal_only') {
      // Send email only to legal team and admin users
      const User = (await import('../models/userModel.js')).default;
      const Role = (await import('../models/roleModel.js')).default;
      
      const legalRoles = await Role.find({
        roleName: { $in: ['Legal Team', 'System Admin'] }
      }).select('_id');
      
      const roleIds = legalRoles.map(r => r._id);
      const legalUsers = await User.find({ role: { $in: roleIds } }).select('name email');
      
      for (const user of legalUsers) {
        try {
          await sendContractCommentEmail(populatedContract, message.trim(), addedByName, user.email, user.name);
        } catch (emailErr) {
          console.error(`Failed to send email to ${user.email}:`, emailErr);
        }
      }
    } else {
      // Send to all stakeholders for non-internal or non-mentioned comments
      await sendContractCommentEmail(populatedContract, message.trim(), addedByName);
    }
    
    // Populate the comment for response
    const updatedContract = await Contract.findById(id)
      .populate('comments.by', 'name email')
      .populate('comments.mentionedUsers', 'name email');
    
    return res.json({ 
      success: true,
      message: "Comment added to contract",
      contract: updatedContract
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
