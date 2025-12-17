import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import { logContractActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import { createInvoiceFromContract } from "../services/invoiceService.js";
import { allocateBlockedCabinsForContract } from "../services/cabinAllocationService.js";
import { ensureDefaultAccessPolicyForContract } from "../services/accessPolicyService.js";
import { grantOnContractActivation, enforceAccessByInvoices } from "../services/accessService.js";

// Compute stage for custom flow
export const getCustomWorkflowStatus = (contract) => {
  const flags = {
    status: contract.status,
    salesSeniorApproved: !!contract.salesSeniorApproved,
    adminapproved: !!contract.adminapproved,
    iscontractsentforsignature: !!contract.iscontractsentforsignature,
    isclientsigned: !!contract.isclientsigned,
    hasFileUrl: !!contract.fileUrl && contract.fileUrl !== "placeholder",
    // Treat Legal Upload as done only when legal uploaded metadata is present (and fileUrl is valid)
    hasLegalUpload: (
      (!!contract.legalUploadedAt || !!contract.legalUploadedBy) &&
      !!contract.fileUrl && contract.fileUrl !== "placeholder"
    ),
  };

  if (contract.status === "pushed" && !flags.salesSeniorApproved) {
    return { stage: "sales_senior_pending", flags };
  }
  // Require explicit legal upload metadata, do not skip to Admin approval just because fileUrl exists
  if (flags.salesSeniorApproved && !flags.hasLegalUpload) {
    return { stage: "legal_upload_pending", flags };
  }
  if (flags.hasLegalUpload && !flags.adminapproved) {
    return { stage: "admin_approval_pending", flags };
  }
  if (!flags.iscontractsentforsignature || (flags.iscontractsentforsignature && !flags.isclientsigned)) {
    return { stage: "client_signature_pending", flags };
  }
  return { stage: "completed", flags };
};

// Sales creates a contract with basic details; status = pushed
export const createBySales = async (req, res) => {
  try {
    const {
      client,
      building,
      startDate,
      endDate,
      capacity,
      monthlyRent,
      commencementDate,
      terms,
      termsandconditions,
    } = req.body || {};

    if (!client || !building || !startDate || !endDate || !capacity || monthlyRent === undefined) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Derive duration in months (inclusive months) and default lock-in to duration
    const calcMonths = (s, e) => {
      const sd = new Date(s);
      const ed = new Date(e);
      let months = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
      if (ed.getDate() >= sd.getDate()) months += 1;
      return Math.max(0, months);
    };
    const derivedDurationMonths = calcMonths(startDate, endDate);

    const contract = await Contract.create({
      client,
      building,
      startDate,
      endDate,
      capacity,
      monthlyRent,
      // Commencement date should be same as start date
      commencementDate: startDate,
      terms: terms || undefined,
      termsandconditions: termsandconditions || undefined,
      // Defaults as per new rules
      durationMonths: derivedDurationMonths,
      lockInPeriodMonths: derivedDurationMonths,
      legalExpenses: 1200,
      cleaningAndRestorationFees: 2000,
      parkingFees: { twoWheeler: 1500, fourWheeler: 5000 },
      status: "pushed",
      createdBy: req.user?._id || undefined,
      lastActionBy: req.user?._id || undefined,
      lastActionAt: new Date(),
    });

    // Ensure client's building is set to the selected building
    try {
      await Client.findByIdAndUpdate(client, { building }, { new: true });
    } catch (e) {
      console.warn("Failed to update client building on sales create:", e?.message);
    }

    await logContractActivity(req, "CREATE", contract._id, client, {
      action: "sales_created",
    });

    return res.json({ success: true, message: "Contract created by Sales", data: { id: contract._id } });
  } catch (err) {
    console.error("createBySales error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Create");
    return res.status(500).json({ success: false, message: "Failed to create contract" });
  }
};

// Sales Senior updates contract and approves
export const salesSeniorUpdateAndApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const { approve, notes, updates } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    // Allow updating broad fields; protect system fields
    const protectedFields = new Set([
      "_id", "id", "status", "createdBy", "lastActionBy", "lastActionAt",
      "adminapproved", "iscontractsentforsignature", "isclientsigned", "clientapproved",
      "salesSeniorApproved", "salesSeniorApprovedBy", "salesSeniorApprovedAt"
    ]);

    if (updates && typeof updates === "object") {
      Object.entries(updates).forEach(([k, v]) => {
        if (!protectedFields.has(k)) {
          contract[k] = v;
        }
      });
    }

    if (approve) {
      contract.salesSeniorApproved = true;
      contract.salesSeniorApprovedBy = req.user?._id || null;
      contract.salesSeniorApprovedAt = new Date();
      contract.salesSeniorApprovalNotes = notes || null;
      // Optional status transition
      if (contract.status === "pushed") {
        contract.status = "submitted_to_legal";
      }
    }

    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: approve ? "sales_senior_approved" : "sales_senior_updated",
      notes,
    });

    return res.json({ success: true, message: approve ? "Approved by Sales Senior" : "Updated by Sales Senior" });
  } catch (err) {
    console.error("salesSeniorUpdateAndApprove error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Senior Update/Approve");
    return res.status(500).json({ success: false, message: "Failed to update/approve" });
  }
};

// Legal uploads final contract document -> sets fileUrl
export const legalUploadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};
    const file = req.file;

    if (!file) return res.status(400).json({ success: false, message: "No file provided" });

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (!contract.salesSeniorApproved) {
      return res.status(400).json({ success: false, message: "Sales Senior approval required before legal upload" });
    }

    const uploadResponse = await imagekit.upload({
      file: file.buffer,
      fileName: `${Date.now()}_${file.originalname}`,
      folder: `/contracts/legal/${id}/`,
      useUniqueFileName: true,
    });

    contract.fileUrl = uploadResponse.url;
    contract.legalUploadedBy = req.user?._id || null;
    contract.legalUploadedAt = new Date();
    contract.legalUploadNotes = notes || null;
    // Optional status transition
    if (contract.status === "submitted_to_legal") {
      contract.status = "legal_reviewed";
    }

    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "legal_uploaded",
      fileName: file.originalname,
    });

    return res.json({ success: true, message: "Document uploaded", data: { fileUrl: contract.fileUrl } });
  } catch (err) {
    console.error("legalUploadDocument error:", err);
    await logErrorActivity(req, err, "Custom Flow: Legal Upload");
    return res.status(500).json({ success: false, message: "Failed to upload document" });
  }
};

// System Admin approves
export const adminApproveCustom = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (!contract.fileUrl || contract.fileUrl === "placeholder") {
      return res.status(400).json({ success: false, message: "Contract document (fileUrl) must be uploaded before admin approval" });
    }

    // Optional hard role gate: System Admin only
    if (req.user?.role?.roleName !== "System Admin") {
      return res.status(403).json({ success: false, message: "Only System Admin can approve at this stage" });
    }

    contract.adminapproved = true;
    contract.adminApprovalReason = reason || null;
    contract.adminApprovedBy = req.user?._id || null;
    contract.adminApprovedAt = new Date();
    if (contract.status === "legal_reviewed" || contract.status === "pending_admin_approval") {
      contract.status = "admin_approved";
    }
    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "admin_approved",
      reason,
    });

    // Ensure default access policy and grant access ONLY if final approval is true
    let ensuredPolicy = null;
    try {
      const policyResult = await ensureDefaultAccessPolicyForContract(contract._id);
      ensuredPolicy = policyResult?.policy || null;
      if (policyResult?.created || policyResult?.updated) {
        console.log("Default access policy ensured (admin approve):", {
          client: String(contract.client),
          created: policyResult.created,
          updated: policyResult.updated,
          policyId: ensuredPolicy?._id,
        });
      }
    } catch (policyErr) {
      console.warn("Failed to ensure default access policy on admin approval:", policyErr?.message);
    }
    try {
      if (contract.isfinalapproval) {
        if (ensuredPolicy?._id) {
          const grantRes = await grantOnContractActivation(contract, {
            policyId: ensuredPolicy._id,
            startsAt: contract.startDate || contract.commencementDate || new Date(),
            endsAt: contract.endDate || undefined,
            source: "AUTO_CONTRACT",
          });
          console.log("Access grants created on admin approval (final approval):", grantRes);
          try {
            await enforceAccessByInvoices(contract.client);
          } catch (enfErr) {
            console.warn("enforceAccessByInvoices after admin approval failed:", enfErr?.message);
          }
        } else {
          console.warn("No default access policy available to grant access on admin approval.");
        }
      } else {
        console.log("Skipping access grants on admin approval: isfinalapproval is not true.");
      }
    } catch (grantErr) {
      console.warn("Access grant on admin approval failed:", grantErr?.message);
    }

    return res.json({ success: true, message: "Admin approved contract" });
  } catch (err) {
    console.error("adminApproveCustom error:", err);
    await logErrorActivity(req, err, "Custom Flow: Admin Approve");
    return res.status(500).json({ success: false, message: "Failed to approve" });
  }
};

// Send to client for signature (Zoho eSign placeholder)
export const sendToClientForSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const { signerEmail, signerName, subject, message } = req.body || {};

    const contract = await Contract.findById(id).populate("client", "companyName email");
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (!contract.adminapproved) {
      return res.status(400).json({ success: false, message: "Admin approval required before sending for signature" });
    }
    if (!contract.fileUrl || contract.fileUrl === "placeholder") {
      return res.status(400).json({ success: false, message: "fileUrl is required to send for signature" });
    }

    // TODO: Integrate real Zoho eSign service. Placeholder envelope id:
    const envelopeId = `ZOHO_SIGN_${Date.now()}`;

    contract.iscontractsentforsignature = true;
    contract.signatureProvider = "zoho_sign";
    contract.signatureEnvelopeId = envelopeId;
    contract.sentForSignatureAt = new Date();
    contract.sentToClientAt = new Date();
    contract.sentToClientBy = req.user?._id || null;
    if (contract.status !== "sent_for_signature") contract.status = "sent_for_signature";
    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "sent_for_signature",
      signerEmail: signerEmail || contract.client?.email,
    });

    return res.json({ success: true, message: "Sent to client for signature", data: { envelopeId } });
  } catch (err) {
    console.error("sendToClientForSignature error:", err);
    await logErrorActivity(req, err, "Custom Flow: Send For Signature");
    return res.status(500).json({ success: false, message: "Failed to send for signature" });
  }
};

// Client feedback -> reset to legal stage
export const clientFeedbackAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ success: false, message: "Feedback text is required" });

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    // Save feedback and add to history
    contract.clientFeedback = text;
    contract.clientFeedbackAt = new Date();
    contract.clientFeedbackHistory = contract.clientFeedbackHistory || [];
    contract.clientFeedbackHistory.push({ text, submittedAt: new Date(), submittedBy: req.user?._id || null });

    // Reset flags to require legal upload again
    contract.iscontractsentforsignature = false;
    contract.adminapproved = false;
    contract.clientapproved = false;
    contract.isclientsigned = false;
    // Clear current uploaded file to enforce re-upload
    contract.fileUrl = null;
    contract.legalUploadedAt = null;
    contract.legalUploadedBy = null;
    contract.legalUploadNotes = null;
    contract.status = "client_feedback_pending";
    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "client_feedback",
    });

    return res.json({ success: true, message: "Feedback recorded and workflow reset to Legal Upload" });
  } catch (err) {
    console.error("clientFeedbackAction error:", err);
    await logErrorActivity(req, err, "Custom Flow: Client Feedback");
    return res.status(500).json({ success: false, message: "Failed to record feedback" });
  }
};

// Client approves/signs -> activate contract
export const clientApproveAndSign = async (req, res) => {
  try {
    const { id } = req.params;
    const { signedBy, signatureDate } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (!contract.iscontractsentforsignature) {
      return res.status(400).json({ success: false, message: "Contract must be sent for signature before signing" });
    }

    contract.clientapproved = true;
    contract.isclientsigned = true;
    contract.signedAt = signatureDate ? new Date(signatureDate) : new Date();
    contract.signedBy = signedBy || contract.signedBy || "client";
    contract.status = "active";
    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "client_signed",
    });
    try {
      const invoice = await createInvoiceFromContract(contract._id, {
        issueOn: "activation",
        prorate: true,
        dueDays: 7,
      });
      console.log(`Auto-created invoice ${invoice?._id} for contract ${contract._id} via custom client approve/sign`);
    } catch (invoiceError) {
      console.error("Failed to auto-create invoice from custom client sign:", invoiceError);
    }
    try {
      const allocResult = await allocateBlockedCabinsForContract(contract._id);
      console.log("Cabin allocation after custom client sign:", allocResult);
    } catch (allocErr) {
      console.error("Cabin allocation failed after custom client sign:", allocErr);
    }

    return res.json({ success: true, message: "Contract signed and activated" });
  } catch (err) {
    console.error("clientApproveAndSign error:", err);
    await logErrorActivity(req, err, "Custom Flow: Client Approve/Sign");
    return res.status(500).json({ success: false, message: "Failed to mark contract signed" });
  }
};

export const getWorkflowStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });
    const status = getCustomWorkflowStatus(contract);
    return res.json({ success: true, data: status });
  } catch (err) {
    console.error("getWorkflowStatus error:", err);
    await logErrorActivity(req, err, "Custom Flow: Get Workflow Status");
    return res.status(500).json({ success: false, message: "Failed to get workflow status" });
  }
};
