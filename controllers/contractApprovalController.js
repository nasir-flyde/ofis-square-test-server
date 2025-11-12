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

// Helper function to check workflow prerequisites
const checkWorkflowPrerequisites = (contract, requiredFlags) => {
  const missing = [];
  for (const flag of requiredFlags) {
    if (!contract[flag]) {
      missing.push(flag);
    }
  }
  return missing;
};

// export const getContractWorkflowStatus = (contract) => {
//   const flags = {
//     iskycuploaded: contract.iskycuploaded,
//     iskycapproved: contract.iskycapproved,
//     adminapproved: contract.adminapproved,
//     legalteamapproved: contract.legalteamapproved,
//     clientapproved: contract.clientapproved,
//     financeapproved: contract.financeapproved,
//     securitydeposited: contract.securitydeposited,
//     isfinalapproval: contract.isfinalapproval,
//     isclientsigned: contract.isclientsigned
//   };

//   // Determine current workflow stage
//   if (!flags.iskycuploaded) return { stage: 'kyc_upload_pending', flags };
//   if (!flags.iskycapproved) return { stage: 'kyc_approval_pending', flags };
//   if (!flags.adminapproved) return { stage: 'admin_approval_pending', flags };
//   if (!flags.legalteamapproved) return { stage: 'legal_approval_pending', flags };
//   if (!flags.financeapproved) return { stage: 'finance_approval_pending', flags };
//   if (!flags.clientapproved) return { stage: 'client_approval_pending', flags };
//   if (!flags.securitydeposited) return { stage: 'security_deposit_pending', flags };
//   if (!flags.isfinalapproval) return { stage: 'final_approval_pending', flags };
//   if (!flags.isclientsigned) return { stage: 'client_signature_pending', flags };
  
//   return { stage: 'completed', flags };
// };

// Helper function to get workflow status for the simplified workflow
export const getContractWorkflowStatus = (contract) => {
  const flags = {
    legalteamapproved: contract.legalteamapproved || false,
    adminapproved: contract.adminapproved || false,
    clientapproved: contract.clientapproved || false,
    iscontractsentforsignature: contract.iscontractsentforsignature || false,
    isclientsigned: contract.isclientsigned || false,
    iskycuploaded: contract.iskycuploaded || false // KYC can be uploaded at any stage
  };

  // Determine current stage based on simplified workflow
  if (!flags.legalteamapproved) return { stage: 'legal_approval_pending', flags };
  if (!flags.adminapproved) return { stage: 'admin_approval_pending', flags };
  if (!flags.clientapproved) return { stage: 'client_approval_pending', flags };
  if (!flags.iscontractsentforsignature) return { stage: 'stamp_paper_pending', flags };
  if (!flags.isclientsigned) return { stage: 'client_signature_pending', flags };
  
  return { stage: 'completed', flags };
};

// Helper function to determine current workflow stage
const getWorkflowStage = (contract) => {
  if (!contract.legalteamapproved) {
    return 'legal_approval_pending';
  }
  if (!contract.adminapproved) {
    return 'admin_approval_pending';
  }
  if (!contract.clientapproved) {
    return 'client_approval_pending';
  }
  if (!contract.iscontractsentforsignature) {
    return 'stamp_paper_pending';
  }
  if (!contract.isclientsigned) {
    return 'client_signature_pending';
  }
  return 'completed';
};

// KYC Document Upload (can be done at any stage)
export const uploadKYCDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No files provided' 
      });
    }

    // Find the contract
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Upload files to ImageKit
    const uploadPromises = files.map(async (file) => {
      const uploadResponse = await imagekit.upload({
        file: file.buffer,
        fileName: `${Date.now()}_${file.originalname}`,
        folder: `/contracts/kyc/${id}/`,
        useUniqueFileName: true
      });

      return {
        fileName: file.originalname,
        fileUrl: uploadResponse.url,
        fileId: uploadResponse.fileId,
        uploadedAt: new Date()
      };
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    // Update contract with KYC documents (append to existing)
    contract.kycDocuments = [...(contract.kycDocuments || []), ...uploadedFiles];
    contract.iskycuploaded = true;
    contract.kycUploadedAt = new Date();
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      filesCount: uploadedFiles.length,
      fileNames: uploadedFiles.map(f => f.fileName)
    });

    res.json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: {
        documents: uploadedFiles,
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error uploading KYC documents:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to upload KYC documents',
      error: error.message 
    });
  }
};

// Legal Team Approval (First step after draft)
export const legalApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, reason } = req.body;

    // Find the contract
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Check if contract is in draft status
    if (contract.status !== 'draft') {
      return res.status(400).json({ 
        success: false, 
        message: 'Contract must be in draft status for legal review' 
      });
    }

    // Update legal approval status
    contract.legalteamapproved = approved;
    contract.legalApprovedBy = approved ? req.user.id : null;
    contract.legalApprovedAt = approved ? new Date() : null;
    contract.legalApprovalReason = reason || null;
    
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      approvedBy: approved ? req.user.id : null,
      approved: approved,
      reason: reason,
      action: approved ? 'legal_approved' : 'legal_rejected'
    });

    res.json({
      success: true,
      message: `Legal review ${approved ? 'approved' : 'rejected'} successfully`,
      data: {
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error processing legal approval:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process legal approval',
      error: error.message 
    });
  }
};

// Admin approval (after legal approval)
export const setAdminApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, reason } = req.body || {};
    
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Check if legal approval is completed first
    if (!contract.legalteamapproved) {
      return res.status(400).json({ 
        success: false, 
        message: 'Legal approval must be completed before admin approval' 
      });
    }

    // Update admin approval
    contract.adminapproved = approved;
    contract.adminApprovedBy = approved ? req.user.id : null;
    contract.adminApprovedAt = approved ? new Date() : null;
    contract.adminApprovalReason = reason || null;
    
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      approvedBy: approved ? req.user.id : null,
      approved: approved,
      reason: reason,
      action: approved ? 'admin_approved' : 'admin_rejected'
    });

    res.json({
      success: true,
      message: `Admin ${approved ? 'approved' : 'rejected'} contract successfully`,
      data: {
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error setting admin approval:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to set admin approval',
      error: error.message 
    });
  }
};


// Client approval (after admin approval)
export const setClientApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, feedback } = req.body || {};
    
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Check if admin approval is completed first
    if (!contract.adminapproved) {
      return res.status(400).json({ 
        success: false, 
        message: 'Admin approval must be completed before client review' 
      });
    }

    // Update client approval
    contract.clientapproved = approved;
    contract.clientApprovedBy = approved ? req.user.id : null;
    contract.clientApprovedAt = approved ? new Date() : null;
    contract.clientFeedback = feedback || null;
    
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      approvedBy: approved ? req.user.id : null,
      approved: approved,
      feedback: feedback,
      action: approved ? 'client_approved' : 'client_feedback_provided'
    });

    res.json({
      success: true,
      message: approved ? 'Client approved contract successfully' : 'Client feedback recorded successfully',
      data: {
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error setting client approval:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to set client approval',
      error: error.message 
    });
  }
};

// Send contract for signature (after client approval)
export const sendForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const { stampPaperAttached, notes } = req.body || {};
    
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Check if client approval is completed first
    if (!contract.clientapproved) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client approval must be completed before sending for signature' 
      });
    }

    // Update contract sent for signature status
    contract.iscontractsentforsignature = true;
    contract.sentForSignatureBy = req.user.id;
    contract.sentForSignatureAt = new Date();
    contract.stampPaperNotes = notes || null;
    
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      sentBy: req.user.id,
      stampPaperAttached: stampPaperAttached,
      notes: notes,
      action: 'sent_for_signature'
    });

    res.json({
      success: true,
      message: 'Contract sent for signature successfully',
      data: {
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error sending contract for signature:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send contract for signature',
      error: error.message 
    });
  }
};


// Mark client as signed and activate contract
export const markClientSigned = async (req, res) => {
  try {
    const { id } = req.params;
    const { signedBy, signatureDate, notes } = req.body || {};
    
    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contract not found' 
      });
    }

    // Check if contract is sent for signature first
    if (!contract.iscontractsentforsignature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contract must be sent for signature before it can be signed' 
      });
    }

    // Update contract signature status and activate
    contract.isclientsigned = true;
    contract.clientSignedBy = signedBy || req.user.id;
    contract.clientSignedAt = signatureDate ? new Date(signatureDate) : new Date();
    contract.signatureNotes = notes || null;
    contract.status = 'active'; // Activate the contract
    
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      signedBy: signedBy || req.user.id,
      signatureDate: contract.clientSignedAt,
      notes: notes,
      action: 'contract_signed_and_activated'
    });

    res.json({
      success: true,
      message: 'Contract signed and activated successfully',
      data: {
        workflowStage: getWorkflowStage(contract),
        contractStatus: contract.status
      }
    });

  } catch (error) {
    console.error('Error marking contract as signed:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark contract as signed',
      error: error.message 
    });
  }
};

// Get contracts by workflow stage (simplified workflow)
export const getContractsByWorkflowStage = async (req, res) => {
  try {
    const { stage } = req.params;
    
    // Define filter based on simplified workflow stages
    let filter = { status: 'draft' }; // Only look at draft contracts in workflow
    
    switch (stage) {
      case 'legal_approval_pending':
        filter.legalteamapproved = false;
        break;
      case 'admin_approval_pending':
        filter.legalteamapproved = true;
        filter.adminapproved = false;
        break;
      case 'client_approval_pending':
        filter.legalteamapproved = true;
        filter.adminapproved = true;
        filter.clientapproved = false;
        break;
      case 'stamp_paper_pending':
        filter.legalteamapproved = true;
        filter.adminapproved = true;
        filter.clientapproved = true;
        filter.iscontractsentforsignature = false;
        break;
      case 'client_signature_pending':
        filter.legalteamapproved = true;
        filter.adminapproved = true;
        filter.clientapproved = true;
        filter.iscontractsentforsignature = true;
        filter.isclientsigned = false;
        break;
      case 'completed':
        filter.legalteamapproved = true;
        filter.adminapproved = true;
        filter.clientapproved = true;
        filter.iscontractsentforsignature = true;
        filter.isclientsigned = true;
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid workflow stage' 
        });
    }
    
    const contracts = await Contract.find(filter)
      .populate("client", "companyName email contactPerson phone")
      .populate("building", "name address pricing")
      .populate("createdBy", "name email")
      .sort({ lastActionAt: -1, createdAt: -1 });
    
    return res.json({ 
      success: true, 
      data: contracts,
      count: contracts.length,
      stage: stage
    });
  } catch (err) {
    console.error("getContractsByWorkflowStage error:", err);
    await logErrorActivity(req, err, 'Get Contracts by Workflow Stage');
    return res.status(500).json({ success: false, message: "Failed to fetch contracts" });
  }
};

// Get workflow status for a specific contract
export const getWorkflowStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    
    if (!contract) {
      return res.status(404).json({ 
        success: false, 
        message: "Contract not found" 
      });
    }
    
    const workflowStatus = getContractWorkflowStatus(contract);
    
    return res.json({ 
      success: true, 
      data: workflowStatus
    });
  } catch (err) {
    console.error("getWorkflowStatus error:", err);
    await logErrorActivity(req, err, 'Get Workflow Status');
    return res.status(500).json({ 
      success: false, 
      message: "Failed to get workflow status" 
    });
  }
};
