import Contract from "../models/contractModel.js";
import Cabin from "../models/cabinModel.js";
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

const checkWorkflowPrerequisites = (contract, requiredFlags, isSystemAdmin = false) => {
  if (isSystemAdmin) return []; // Bypass all checks for System Admin

  const missing = [];
  for (const flag of requiredFlags) {
    if (!contract[flag]) {
      missing.push(flag);
    }
  }
  return missing;
};

// Check if user is System Admin
const isSystemAdmin = (user) => {
  return user?.role?.roleName === 'System Admin';
};

// Final Approval (System Admin or users with CONTRACT_FINAL_APPROVE)
export const finalApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved = true, reason } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    // Only allow when invoices have been fully paid and flag is set, OR if user is System Admin
    if (req.user.role?.roleName !== 'System Admin') {
      return res.status(400).json({ success: false, message: 'Final approval not ready. Ensure all invoices are paid.' });
    }

    // Set final approval metadata
    contract.finalApprovedBy = approved ? (req.user?.id || null) : null;
    contract.finalApprovedAt = approved ? new Date() : null;
    contract.finalApprovalReason = reason || null;
    // Set isfinalapproval flag to true when approved
    if (approved) {
      contract.isfinalapproval = true;
    }
    await contract.save();

    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: approved ? 'final_approved' : 'final_rejected',
      approved,
      reason,
    });

    return res.json({
      success: true,
      message: `Contract ${approved ? 'approved' : 'rejected'} successfully`,
      data: {
        id: contract._id,
        finalApprovedBy: contract.finalApprovedBy,
        finalApprovedAt: contract.finalApprovedAt,
        finalApprovalReason: contract.finalApprovalReason,
        isfinalapproval: contract.isfinalapproval
      }
    });

  } catch (error) {
    console.error('Error in final approval:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process final approval',
      error: error.message
    });
  }
};
export const setFinanceApproval = async (req, res) => {
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
    if (!contract.legalteamapproved || !contract.adminapproved) {
      return res.status(400).json({
        success: false,
        message: 'Legal and Admin approvals must be completed before Finance approval'
      });
    }
    const isAdminOverride = isSystemAdmin(req.user);
    contract.financeapproved = !!approved;
    contract.financeApprovedBy = approved ? (req.user?.id || null) : null;
    contract.financeApprovedAt = approved ? new Date() : null;
    contract.financeApprovalReason = reason || (isAdminOverride ? 'Approved by System Admin override' : null);

    // Log admin override if applicable
    if (isAdminOverride) {
      console.log(`System Admin ${req.user._id} overrode finance approval for contract ${id}`);
    }

    await contract.save();
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      approvedBy: approved ? (req.user?.id || null) : null,
      approved: !!approved,
      reason: reason,
      action: approved ? 'finance_approved' : 'finance_rejected'
    });

    return res.json({
      success: true,
      message: `Finance ${approved ? 'approved' : 'rejected'} contract successfully`,
      data: {
        workflowStage: getWorkflowStage(contract)
      }
    });
  } catch (error) {
    console.error('Error setting finance approval:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to set finance approval',
      error: error.message
    });
  }
};

// Allowed KYC document types as per Contract.kycDocuments schema
const KYC_DOC_TYPES = [
  'addressProof',
  'boardResolutionOrLetterOfAuthority',
  'photoIdAndAddressProofOfSignatory',
  'certificateOfIncorporation',
  'businessLicenseGST',
  'panCard',
  'tanNo',
  'moa',
  'aoa'
];

// Approve KYC (only marks approval, upload is separate)
export const approveKYC = async (req, res) => {
  try {
    const { id } = req.params;

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    // Ensure at least one KYC document is uploaded before global approval
    const anyUploaded = KYC_DOC_TYPES.some(dt => contract.kycDocuments?.[dt]?.fileUrl);
    if (!contract.iskycuploaded || !anyUploaded) {
      return res.status(400).json({ success: false, message: 'KYC documents must be uploaded before approval' });
    }

    // Mark KYC as approved
    contract.iskycapproved = true;
    contract.kycApprovedAt = new Date();
    contract.kycApprovedBy = req.user?.id || null;
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_approved',
      approvedBy: req.user?.id || null,
      documentsCount: contract.kycDocuments?.length || 0,
    });

    return res.json({
      success: true,
      message: 'KYC approved successfully',
      data: { workflowStage: getWorkflowStage(contract) }
    });
  } catch (error) {
    console.error('Error approving KYC:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve KYC', error: error.message });
  }
};

// Upload a specific KYC document by type (structured fields)
export const uploadKYCDocumentByType = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const file = req.file;

    if (!KYC_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC document type' });
    }
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    const uploadResponse = await imagekit.upload({
      file: file.buffer,
      fileName: `${Date.now()}_${file.originalname}`,
      folder: `/contracts/kyc/${id}/${docType}/`,
      useUniqueFileName: true
    });

    contract.kycDocuments = contract.kycDocuments || {};
    contract.kycDocuments[docType] = {
      fileName: file.originalname,
      fileUrl: uploadResponse.url,
      approvedBy: null,
      approved: false,
      uploadedAt: new Date()
    };
    contract.iskycuploaded = true;
    // Reset global approval if any doc changes
    contract.iskycapproved = false;
    contract.kycApprovedAt = null;
    contract.kycApprovedBy = null;
    await contract.save();

    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_document_uploaded',
      docType,
      fileName: file.originalname
    });

    return res.json({
      success: true,
      message: 'KYC document uploaded',
      data: { docType, fileUrl: uploadResponse.url, workflowStage: getWorkflowStage(contract) }
    });
  } catch (error) {
    console.error('Error uploading KYC document by type:', error);
    return res.status(500).json({ success: false, message: 'Failed to upload KYC document', error: error.message });
  }
};

// Approve a specific KYC document by type
export const approveKYCDocumentByType = async (req, res) => {
  try {
    const { id, docType } = req.params;
    if (!KYC_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC document type' });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    const doc = contract.kycDocuments?.[docType];
    if (!doc || !doc.fileUrl) {
      return res.status(400).json({ success: false, message: 'Document not uploaded yet' });
    }

    contract.kycDocuments[docType].approved = true;
    contract.kycDocuments[docType].approvedBy = req.user?.id || null;
    await contract.save(); // pre-save hook will set iskycapproved when all docs approved

    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_document_approved',
      docType,
      approvedBy: req.user?.id || null
    });

    return res.json({ success: true, message: 'KYC document approved', data: { docType, approved: true, workflowStage: getWorkflowStage(contract) } });
  } catch (error) {
    console.error('Error approving KYC document:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve KYC document', error: error.message });
  }
};

// Bulk upload multiple KYC documents by type in a single request
// Accepts multipart/form-data with field name 'documents' (multiple files) and a matching 'docTypes' array.
// docTypes can be provided as JSON string (e.g., ["panCard","addressProof"]) or comma-separated string, or as repeated fields.
export const bulkUploadKYCDocumentsByType = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files || [];

    // Parse docTypes from body
    let docTypesRaw = req.body?.docTypes;
    let docTypes = [];
    if (Array.isArray(docTypesRaw)) {
      docTypes = docTypesRaw;
    } else if (typeof docTypesRaw === 'string') {
      try {
        const parsed = JSON.parse(docTypesRaw);
        docTypes = Array.isArray(parsed) ? parsed : String(docTypesRaw).split(',').map(s => s.trim()).filter(Boolean);
      } catch {
        docTypes = String(docTypesRaw).split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    if (!files.length) {
      return res.status(400).json({ success: false, message: 'No files provided' });
    }
    if (docTypes.length !== files.length) {
      return res.status(400).json({ success: false, message: 'docTypes count must match number of uploaded files' });
    }

    // Validate all docTypes
    for (const dt of docTypes) {
      if (!KYC_DOC_TYPES.includes(dt)) {
        return res.status(400).json({ success: false, message: `Invalid KYC document type: ${dt}` });
      }
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    contract.kycDocuments = contract.kycDocuments || {};

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const docType = docTypes[i];

      const uploadResponse = await imagekit.upload({
        file: file.buffer,
        fileName: `${Date.now()}_${file.originalname}`,
        folder: `/contracts/kyc/${id}/${docType}/`,
        useUniqueFileName: true
      });

      contract.kycDocuments[docType] = {
        fileName: file.originalname,
        fileUrl: uploadResponse.url,
        fileId: uploadResponse.fileId,
        approved: false,
        approvedBy: null,
        uploadedAt: new Date()
      };

      results.push({ docType, fileUrl: uploadResponse.url });
    }

    // Mark KYC as uploaded and reset global approval
    contract.iskycuploaded = true;
    contract.kycUploadedAt = new Date();
    contract.iskycapproved = false;
    contract.kycApprovedAt = null;
    contract.kycApprovedBy = null;

    await contract.save();

    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_documents_bulk_uploaded',
      count: results.length,
      docTypes: results.map(r => r.docType)
    });

    return res.json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: { items: results, workflowStage: getWorkflowStage(contract) }
    });
  } catch (error) {
    console.error('Error in bulk KYC upload:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk upload KYC documents', error: error.message });
  }
};

// Bulk approve multiple KYC document types in one request
// Body: { docTypes: ["panCard","addressProof" ] } OR { all: true } to approve all uploaded docs
export const bulkApproveKYCDocumentsByType = async (req, res) => {
  try {
    const { id } = req.params;
    const { all } = req.body || {};
    let docTypes = [];

    // Parse docTypes similar to bulk upload
    let docTypesRaw = req.body?.docTypes;
    if (all === true) {
      // Approve all uploaded docs
      const contractForScan = await Contract.findById(id);
      if (!contractForScan) {
        return res.status(404).json({ success: false, message: 'Contract not found' });
      }
      docTypes = KYC_DOC_TYPES.filter(dt => contractForScan.kycDocuments?.[dt]?.fileUrl);
    } else if (Array.isArray(docTypesRaw)) {
      docTypes = docTypesRaw;
    } else if (typeof docTypesRaw === 'string') {
      try {
        const parsed = JSON.parse(docTypesRaw);
        docTypes = Array.isArray(parsed) ? parsed : String(docTypesRaw).split(',').map(s => s.trim()).filter(Boolean);
      } catch {
        docTypes = String(docTypesRaw || '').split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    if (!docTypes || docTypes.length === 0) {
      return res.status(400).json({ success: false, message: 'No docTypes provided' });
    }

    for (const dt of docTypes) {
      if (!KYC_DOC_TYPES.includes(dt)) {
        return res.status(400).json({ success: false, message: `Invalid KYC document type: ${dt}` });
      }
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    contract.kycDocuments = contract.kycDocuments || {};
    const approvedDocTypes = [];
    const skipped = [];

    for (const dt of docTypes) {
      const doc = contract.kycDocuments?.[dt];
      if (!doc || !doc.fileUrl) {
        skipped.push({ docType: dt, reason: 'Document not uploaded' });
        continue;
      }
      contract.kycDocuments[dt].approved = true;
      contract.kycDocuments[dt].approvedBy = req.user?.id || null;
      approvedDocTypes.push(dt);
    }

    await contract.save();

    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_documents_bulk_approved',
      approvedDocTypes,
      skipped
    });

    return res.json({
      success: true,
      message: 'Selected KYC documents approved',
      data: {
        approvedDocTypes,
        skipped,
        workflowStage: getWorkflowStage(contract)
      }
    });
  } catch (error) {
    console.error('Error in bulk KYC approve:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk approve KYC documents', error: error.message });
  }
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

    // Note: The schema defines structured kycDocuments per document type.
    // This bulk-upload endpoint will not mutate structured fields to avoid schema mismatch.
    // We only mark that KYC docs exist and return the uploaded files for reference.
    contract.iskycuploaded = true;
    contract.kycUploadedAt = new Date();
    // Since documents were uploaded, ensure global approval is reset
    contract.iskycapproved = false;
    contract.kycApprovedAt = null;
    contract.kycApprovedBy = null;
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      filesCount: uploadedFiles.length,
      fileNames: uploadedFiles.map(f => f.fileName)
    });

    res.json({
      success: true,
      message: 'KYC documents uploaded successfully. Use per-document upload to attach to specific KYC fields.',
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


    // Update legal approval status
    const isAdminOverride = isSystemAdmin(req.user);
    contract.legalteamapproved = approved;
    contract.legalApprovedBy = approved ? req.user.id : null;
    contract.legalApprovedAt = approved ? new Date() : null;
    contract.legalApprovalReason = reason || (isAdminOverride ? 'Approved by System Admin override' : null);

    // Log admin override if applicable
    if (isAdminOverride) {
      console.log(`System Admin ${req.user._id} overrode legal approval for contract ${id}`);
    }

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

// Admin approval (System Admin only)
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

    // Check if user has System Admin role
    if (req.user.role?.roleName !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only System Admin can perform admin approval'
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

    // Check if admin approval is completed first (unless user is System Admin)
    if ((!contract.legalteamapproved || !contract.adminapproved) && !isSystemAdmin(req.user)) {
      return res.status(400).json({
        success: false,
        message: 'Legal and Admin approvals must be completed before Finance approval'
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

// Upload stamp paper (separate from sending for signature)
export const uploadStampPaper = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No stamp paper file provided'
      });
    }

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
        message: 'Client approval must be completed before uploading stamp paper'
      });
    }

    // Upload file to ImageKit
    const uploadResponse = await imagekit.upload({
      file: file.buffer,
      fileName: `${Date.now()}_${file.originalname}`,
      folder: `/contracts/stamp-papers/${id}/`,
      useUniqueFileName: true
    });

    // Update contract with stamp paper info
    contract.stampPaperUrl = uploadResponse.url;
    contract.stampPaperFileId = uploadResponse.fileId;
    contract.stampPaperNotes = notes || null;
    contract.stampPaperUploadedAt = new Date();
    contract.stampPaperUploadedBy = req.user.id;
    contract.iscontractstamppaperupload = true;

    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      uploadedBy: req.user.id,
      fileName: file.originalname,
      notes: notes,
      action: 'stamp_paper_uploaded'
    });

    res.json({
      success: true,
      message: 'Stamp paper uploaded successfully',
      data: {
        stampPaperUrl: uploadResponse.url,
        workflowStage: getWorkflowStage(contract)
      }
    });

  } catch (error) {
    console.error('Error uploading stamp paper:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload stamp paper',
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


// Security Deposit Recording (after client approval)
export const recordSecurityDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, notes, paidAt } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: 'Contract not found'
      });
    }

    // Compute Security Deposit as 25% of (durationMonths × monthlyRent)
    // Prefer explicit durationMonths on contract; fallback to months diff between start and end
    const safeNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const monthsFromField = safeNumber(contract.durationMonths) > 0 ? safeNumber(contract.durationMonths) : null;
    const monthsFromDates = (() => {
      try {
        const start = contract.startDate ? new Date(contract.startDate) : null;
        const end = contract.endDate ? new Date(contract.endDate) : null;
        if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        const years = end.getFullYear() - start.getFullYear();
        const months = end.getMonth() - start.getMonth() + years * 12;
        return months > 0 ? months : 0;
      } catch { return null; }
    })();
    const durationMonths = monthsFromField ?? monthsFromDates ?? 0;
    const monthlyRent = safeNumber(contract.monthlyRent);
    const computedAmountRaw = monthlyRent * durationMonths * 0.25;
    const computedAmount = Math.round(computedAmountRaw); // round to nearest rupee

    // Update security deposit information (override any client-provided amount)
    contract.securitydeposited = true;
    contract.securityDeposit = {
      amount: computedAmount,
      type: type || 'cash',
      notes: notes || null
    };
    contract.securityDepositPaidAt = paidAt ? new Date(paidAt) : new Date();
    contract.securityDepositRecordedBy = req.user.id;

    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      recordedBy: req.user.id,
      amount: computedAmount,
      type: type,
      notes: notes,
      paidAt: contract.securityDepositPaidAt,
      action: 'security_deposit_recorded'
    });

    res.json({
      success: true,
      message: 'Security deposit recorded successfully',
      data: {
        workflowStage: getWorkflowStage(contract),
        securityDeposit: contract.securityDeposit,
        securityDepositPaidAt: contract.securityDepositPaidAt
      }
    });

  } catch (error) {
    console.error('Error recording security deposit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record security deposit',
      error: error.message
    });
  }
};
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

    // Auto-allocate any active blocks linked to this contract
    try {
      const cabinsToAllocate = await Cabin.find({
        "blocks.contract": id,
        "blocks.status": "active",
        status: { $in: ["available", "blocked"] },
      });

      for (const cabin of cabinsToAllocate) {
        const blk = (cabin.blocks || []).find(
          (b) => String(b.contract) === String(id) && b.status === "active"
        );
        if (!blk) continue;

        // Allocate cabin to client
        cabin.status = "occupied";
        cabin.allocatedTo = blk.client;
        cabin.contract = contract._id;
        cabin.allocatedAt = new Date();
        blk.status = "allocated";
        blk.updatedAt = new Date();
        await cabin.save();
      }
    } catch (allocErr) {
      console.warn("Auto-allocation from blocks failed:", allocErr?.message);
    }

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

// Generic function to update contract approval flags
export const updateContractApprovalFlag = async (req, res) => {
  try {
    const { id } = req.params;
    const { flag, approved, reason } = req.body || {};

    // Validation
    if (!flag) {
      return res.status(400).json({
        success: false,
        message: 'Flag name is required'
      });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: 'Contract not found'
      });
    }

    // List of allowed boolean flags that can be updated
    const allowedFlags = [
      'iskycapproved',
      'legalteamapproved',
      'adminapproved',
      'clientapproved',
      'financeapproved',
      'securitydeposited',
      'iscontractstamppaperupload',
      'isfinalapproval',
      'isclientsigned'
    ];

    if (!allowedFlags.includes(flag)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update flag: ${flag}. Allowed flags: ${allowedFlags.join(', ')}`
      });
    }

    // Update the specified flag
    contract[flag] = !!approved;

    // Update related timestamp fields based on the flag
    const approvedAtFieldMap = {
      'iskycapproved': 'kycApprovedAt',
      'legalteamapproved': 'legalApprovedAt',
      'adminapproved': 'adminApprovedAt',
      'clientapproved': 'clientApprovedAt',
      'financeapproved': 'financeApprovedAt',
      'isfinalapproval': 'finalApprovedAt',
      'isclientsigned': 'signedAt'
    };

    const approvedByFieldMap = {
      'iskycapproved': 'kycApprovedBy',
      'legalteamapproved': 'legalApprovedBy',
      'adminapproved': 'adminApprovedBy',
      'clientapproved': 'clientApprovedBy',
      'financeapproved': 'financeApprovedBy',
      'isfinalapproval': 'finalApprovedBy',
      'isclientsigned': null // client signed doesn't need a by field as it's automatic
    };

    if (approvedAtFieldMap[flag]) {
      contract[approvedAtFieldMap[flag]] = approved ? new Date() : null;
    }

    if (approvedByFieldMap[flag] && approvedByFieldMap[flag] !== null) {
      contract[approvedByFieldMap[flag]] = approved ? (req.user?.id || null) : null;
    }

    // Add reason if provided
    const reasonFieldMap = {
      'iskycapproved': 'kycApprovalReason',
      'legalteamapproved': 'legalApprovalReason',
      'adminapproved': 'adminApprovalReason',
      'clientapproved': 'clientApprovalReason',
      'financeapproved': 'financeApprovalReason',
      'isfinalapproval': 'finalApprovalReason'
    };

    if (reasonFieldMap[flag] && reason) {
      contract[reasonFieldMap[flag]] = reason;
    }

    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      flag: flag,
      approved: !!approved,
      approvedBy: approved ? (req.user?.id || null) : null,
      reason: reason || null,
      action: `${flag.replace(/^is/, '').replace(/([A-Z])/g, '_$1').toLowerCase()}_updated`
    });

    return res.json({
      success: true,
      message: `Contract flag ${flag} updated successfully`,
      data: {
        contractId: contract._id,
        flag: flag,
        value: !!approved
      }
    });

  } catch (err) {
    console.error("updateContractApprovalFlag error:", err);
    await logErrorActivity(req, err, 'Update Contract Approval Flag');
    return res.status(500).json({
      success: false,
      message: "Failed to update contract approval flag"
    });
  }
};
