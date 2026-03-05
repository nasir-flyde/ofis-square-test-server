import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";
import Building from "../models/buildingModel.js";
import Cabin from "../models/cabinModel.js";
import loggedZohoSign from "../utils/loggedZohoSign.js";
import { logContractActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import { createBillingDocumentFromContract } from "../services/invoiceService.js";
import { allocateBlockedCabinsForContract } from "../services/cabinAllocationService.js";
import { ensureDefaultAccessPolicyForContract } from "../services/accessPolicyService.js";
import { grantOnContractActivation, enforceAccessByInvoices } from "../services/accessService.js";
import { sendAdminApprovalRequestEmail, sendLegalReviewRequestEmail } from "../utils/contractEmailService.js";
import SecurityDeposit from "../models/securityDepositModel.js";
import fetch from "node-fetch";
import { getAccessToken } from "../utils/zohoSignAuth.js";
import { sendNotification } from "../utils/notificationHelper.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";

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
      billingStartDate,
      billingEndDate,
      capacity,
      monthlyRent,
      terms,
      termsandconditions,
      kycDocumentItems: kycItemsFromBody,
      printerCredits,
      // Extended/optional overrides
      initialCredits,
      legalExpenses,
      allocationSeatsNumber,
      parkingSpaces,
      parkingFees,
      lockInPeriodMonths,
      noticePeriodDays,
      escalation,
      escalationRatePercentage,
      renewal,
      fullyServicedBusinessHours,
      cleaningAndRestorationFees,
      freebies,
      payAsYouGo,
      termsAndConditionAcceptance,
    } = req.body || {};

    if (!client || !building || !startDate || !endDate || !capacity) {
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

    // Normalize termsandconditions: accept array or single object
    const normalizedTermsAndConditions = Array.isArray(termsandconditions)
      ? termsandconditions
      : (termsandconditions && typeof termsandconditions === 'object' ? [termsandconditions] : undefined);

    // Prepare normalized KYC items to attach on contract
    let kycItemsToAttach = [];
    if (Array.isArray(kycItemsFromBody) && kycItemsFromBody.length > 0) {
      kycItemsToAttach = kycItemsFromBody
        .filter((it) => it && (it.fieldName || it.url))
        .map((it) => ({
          document: it.document || null,
          fieldName: it.fieldName || undefined,
          fileName: it.fileName || undefined,
          url: it.url || undefined,
          number: it.number || undefined,
          approved: false,
          approvedBy: null,
          uploadedAt: it.uploadedAt ? new Date(it.uploadedAt) : new Date(),
        }));
    } else {
      try {
        const clientDoc = await Client.findById(client).select('kycDocumentItems');
        if (Array.isArray(clientDoc?.kycDocumentItems) && clientDoc.kycDocumentItems.length > 0) {
          kycItemsToAttach = clientDoc.kycDocumentItems.map((it) => ({
            document: it.document || null,
            fieldName: it.fieldName,
            fileName: it.fileName,
            url: it.url,
            number: it.number,
            approved: false,
            approvedBy: null,
            uploadedAt: it.uploadedAt ? new Date(it.uploadedAt) : new Date(),
          }));
        }
      } catch (e) {
        console.warn('createBySales: failed to copy client kycDocumentItems:', e?.message || e);
      }
    }
    const kycCount = Array.isArray(kycItemsToAttach) ? kycItemsToAttach.length : 0;

    // Determine monthlyRent: use provided value if valid; otherwise derive from Building perSeatPricing
    let monthlyRentToUse = null;
    if (monthlyRent !== undefined && monthlyRent !== null && monthlyRent !== "") {
      const mr = Number(monthlyRent);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ success: false, message: "monthlyRent must be a non-negative number" });
      }
      monthlyRentToUse = mr;
    } else {
      try {
        const buildingDoc = await Building.findById(building).select('perSeatPricing status');
        if (!buildingDoc) {
          return res.status(404).json({ success: false, message: "Building not found" });
        }
        if (buildingDoc.status && String(buildingDoc.status).toLowerCase() !== 'active') {
          return res.status(400).json({ success: false, message: "Building is not active" });
        }
        if (buildingDoc.perSeatPricing == null || buildingDoc.perSeatPricing < 0) {
          return res.status(400).json({ success: false, message: "Building per seat pricing is not configured" });
        }
        monthlyRentToUse = Number(buildingDoc.perSeatPricing) * Number(capacity);
      } catch (bErr) {
        console.warn('createBySales: failed to derive monthlyRent from building', bErr?.message || bErr);
        return res.status(400).json({ success: false, message: "Unable to derive monthlyRent" });
      }
    }

    // Only keep clientAcceptance if provided
    const tcaOut = termsAndConditionAcceptance?.clientAcceptance
      ? { clientAcceptance: termsAndConditionAcceptance.clientAcceptance }
      : undefined;

    // Resolve tax profile selection for this contract
    let gst_no = req.body?.gst_no || req.body?.gstNo || req.body?.tax_registration_no || undefined;
    let gst_treatment = req.body?.gst_treatment || req.body?.gstTreatment || undefined;
    let place_of_supply = req.body?.place_of_supply || req.body?.placeOfSupply || undefined;

    try {
      // If any of the tax fields are missing, try deriving from client tax info
      if (!gst_no || !gst_treatment || !place_of_supply) {
        const clientForTax = await Client.findById(client).select('gstNo gstNumber gstTreatment taxInfoList billingAddress.state_code billingAddress.state');
        if (clientForTax) {
          const taxList = Array.isArray(clientForTax.taxInfoList) ? clientForTax.taxInfoList : [];
          const selectedTaxRegistrationNo = req.body?.selectedTaxRegistrationNo;
          const selectedTaxIndex = (req.body?.selectedTaxIndex !== undefined && req.body?.selectedTaxIndex !== null)
            ? Number(req.body.selectedTaxIndex)
            : null;

          let chosenTax = null;
          if (selectedTaxRegistrationNo) {
            chosenTax = taxList.find((t) => t?.tax_registration_no === selectedTaxRegistrationNo) || null;
          } else if (selectedTaxIndex !== null && !Number.isNaN(selectedTaxIndex) && taxList[selectedTaxIndex]) {
            chosenTax = taxList[selectedTaxIndex];
          } else {
            chosenTax = taxList.find((t) => t?.is_primary) || taxList[0] || null;
          }

          if (!gst_no && chosenTax?.tax_registration_no) gst_no = chosenTax.tax_registration_no;
          if (!place_of_supply && chosenTax?.place_of_supply) place_of_supply = chosenTax.place_of_supply;
          if (!gst_treatment && clientForTax.gstTreatment) gst_treatment = clientForTax.gstTreatment;

          if (!gst_no && (clientForTax.gstNo || clientForTax.gstNumber)) {
            gst_no = clientForTax.gstNo || clientForTax.gstNumber;
          }
          if (!place_of_supply) {
            place_of_supply = clientForTax?.billingAddress?.state_code || clientForTax?.billingAddress?.state || undefined;
          }
        }
      }
    } catch (taxErr) {
      console.warn('createBySales: failed to resolve tax profile:', taxErr?.message || taxErr);
    }

    const contract = await Contract.create({
      client,
      building,
      startDate,
      endDate,
      billingStartDate: billingStartDate || startDate,
      billingEndDate: billingEndDate || endDate,
      capacity,
      monthlyRent: monthlyRentToUse,
      ...(Number.isInteger(printerCredits) && printerCredits >= 0 ? { printerCredits } : {}),
      // Optional only: do not default/grant at this stage
      ...(Number.isInteger(initialCredits) ? { initialCredits: Number(initialCredits) } : {}),
      ...(req.body && Number.isInteger(req.body.allocated_credits) ? { allocated_credits: req.body.allocated_credits } : {}),
      // Commencement date should be same as start date
      commencementDate: startDate,
      terms: terms || undefined,
      ...(normalizedTermsAndConditions && { termsandconditions: normalizedTermsAndConditions }),
      // Computed duration and lock-in
      durationMonths: derivedDurationMonths,
      lockInPeriodMonths: (lockInPeriodMonths !== undefined && lockInPeriodMonths !== null)
        ? Number(lockInPeriodMonths)
        : derivedDurationMonths,
      // Expenses/fees
      legalExpenses: (legalExpenses !== undefined && legalExpenses !== null) ? Number(legalExpenses) : 1200,
      cleaningAndRestorationFees: (cleaningAndRestorationFees !== undefined && cleaningAndRestorationFees !== null)
        ? Number(cleaningAndRestorationFees)
        : 2000,
      // Parking
      ...(allocationSeatsNumber !== undefined ? { allocationSeatsNumber: Number(allocationSeatsNumber) } : {}),
      ...(parkingSpaces ? { parkingSpaces } : {}),
      parkingFees: {
        twoWheeler: (parkingFees && parkingFees.twoWheeler !== undefined) ? Number(parkingFees.twoWheeler) : 1500,
        fourWheeler: (parkingFees && parkingFees.fourWheeler !== undefined) ? Number(parkingFees.fourWheeler) : 5000,
      },
      ...(noticePeriodDays !== undefined ? { noticePeriodDays: Number(noticePeriodDays) } : {}),
      ...(escalation ? { escalation } : {}),
      ...(escalationRatePercentage !== undefined ? { escalationRatePercentage: Number(escalationRatePercentage) } : {}),
      ...(renewal ? { renewal } : {}),
      ...(fullyServicedBusinessHours ? { fullyServicedBusinessHours } : {}),
      ...(Array.isArray(freebies) ? { freebies } : {}),
      ...(payAsYouGo ? { payAsYouGo } : {}),
      ...(tcaOut ? { termsAndConditionAcceptance: tcaOut } : {}),
      // Persist selected tax profile
      ...(gst_no ? { gst_no } : {}),
      ...(gst_treatment ? { gst_treatment } : {}),
      ...(place_of_supply ? { place_of_supply } : {}),
      status: "pushed",
      createdBy: req.user?._id || undefined,
      lastActionBy: req.user?._id || undefined,
      lastActionAt: new Date(),
      ...(kycCount > 0 ? { kycDocumentItems: kycItemsToAttach, iskycuploaded: true } : {}),
    });

    // Link existing Security Deposit if provided in payload
    let securityDepositId = req.body?.securityDepositId || null;
    if (securityDepositId) {
      try {
        const sd = await SecurityDeposit.findById(securityDepositId);
        if (sd) {
          // Attach to contract and ensure building linkage exists
          sd.contract = sd.contract || contract._id;
          sd.building = sd.building || building;
          await sd.save();
          contract.securityDeposit = sd._id;
          await contract.save();
          // Optionally also set on client (latest/current deposit ref)
          try {
            await Client.findByIdAndUpdate(client, { securityDeposit: sd._id }, { new: true });
          } catch (e) {
            console.warn("createBySales: failed to set client.securityDeposit:", e?.message || e);
          }
        } else {
          console.warn("createBySales: provided securityDepositId not found:", securityDepositId);
        }
      } catch (e) {
        console.warn("createBySales: failed to link securityDepositId:", e?.message || e);
      }
    }

    // Ensure client's building is set only if not already attached
    try {
      const clientDoc = await Client.findById(client).select('building');
      if (clientDoc && !clientDoc.building) {
        await Client.findByIdAndUpdate(client, { building }, { new: true });
        console.log(`Attached building ${building} to client ${client}`);
      } else {
        console.log(`Skipping client building update: already set for client ${client}`);
      }
    } catch (e) {
      console.warn("Failed to check/update client building on sales create:", e?.message);
    }

    await logContractActivity(req, "CREATE", contract._id, client, {
      action: "sales_created",
      kycItemsAttached: kycCount,
    });

    // Notify Sales role users: commercials submitted for senior approval
    try {
      const populatedForNotify = await Contract.findById(contract._id)
        .populate("client", "companyName")
        .populate("building", "name");
      const companyName = populatedForNotify?.client?.companyName || 'Client';
      const buildingName = populatedForNotify?.building?.name || 'Building';

      const salesRole = await Role.findOne({ roleName: 'Sales' }).lean();
      if (!salesRole?._id) {
        console.warn('createBySales: Sales role not found');
      } else {
        const salesUsers = await User.find({ role: salesRole._id }).select('email _id name').lean();
        for (const u of salesUsers) {
          const to = { userId: u._id };
          if (u.email) to.email = u.email;
          await sendNotification({
            to,
            channels: { email: Boolean(to.email), sms: false },
            templateKey: 'sales_senior_commercials_approval',
            templateVariables: {
              managerName: u.name || 'Manager',
              building: buildingName,
              companyName: companyName,
              contractId: String(contract._id)
            },
            title: 'Commercials Submitted for Senior Approval',
            metadata: {
              category: 'contract',
              tags: ['sales_senior_commercials_approval'],
              route: `/contracts/${contract._id}`,
              deepLink: `ofis://contracts/${contract._id}`,
              routeParams: { id: String(contract._id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      }
    } catch (notifyErr) {
      console.warn('createBySales: failed to notify Sales users:', notifyErr?.message || notifyErr);
    }

    return res.json({ success: true, message: "Contract created by Sales", data: { id: contract._id, securityDepositId: contract.securityDeposit || securityDepositId || null } });
  } catch (err) {
    console.error("createBySales error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Create");
    return res.status(500).json({ success: false, message: "Failed to create contract" });
  }
};

// Sales edits commercials on an existing contract (resets flow to pushed)
export const salesEditCommercials = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      client,
      building,
      startDate,
      endDate,
      capacity,
      monthlyRent,
      terms,
      termsandconditions,
      printerCredits,
      // Extended/optional overrides
      initialCredits,
      legalExpenses,
      allocationSeatsNumber,
      parkingSpaces,
      parkingFees,
      lockInPeriodMonths,
      noticePeriodDays,
      escalation,
      escalationRatePercentage,
      renewal,
      fullyServicedBusinessHours,
      cleaningAndRestorationFees,
      freebies,
      payAsYouGo,
      termsAndConditionAcceptance,
    } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    // Track if building changed to update client record
    const originalBuilding = String(contract.building || "");

    // Update allowed fields (basic)
    if (client) contract.client = client;
    if (building) contract.building = building;
    if (startDate) contract.startDate = startDate;
    if (endDate) contract.endDate = endDate;
    if (typeof capacity !== 'undefined' && capacity !== null) contract.capacity = Number(capacity);

    if (typeof terms !== 'undefined') contract.terms = terms;
    if (typeof printerCredits !== 'undefined' && Number.isInteger(printerCredits) && printerCredits >= 0) {
      contract.printerCredits = printerCredits;
    }

    // Normalize and set termsandconditions if provided
    if (typeof termsandconditions !== 'undefined') {
      const normalizedTC = Array.isArray(termsandconditions)
        ? termsandconditions
        : (termsandconditions && typeof termsandconditions === 'object' ? [termsandconditions] : []);
      contract.termsandconditions = normalizedTC;
    }

    // Extended fields overrides if provided
    if (typeof initialCredits !== 'undefined' && initialCredits !== null) contract.initialCredits = Number(initialCredits);
    if (typeof legalExpenses !== 'undefined' && legalExpenses !== null) contract.legalExpenses = Number(legalExpenses);
    if (typeof allocationSeatsNumber !== 'undefined' && allocationSeatsNumber !== null) contract.allocationSeatsNumber = Number(allocationSeatsNumber);
    if (parkingSpaces && typeof parkingSpaces === 'object') contract.parkingSpaces = parkingSpaces;
    if (parkingFees && typeof parkingFees === 'object') {
      contract.parkingFees = {
        twoWheeler: (parkingFees.twoWheeler !== undefined && parkingFees.twoWheeler !== null) ? Number(parkingFees.twoWheeler) : (contract.parkingFees?.twoWheeler ?? 1500),
        fourWheeler: (parkingFees.fourWheeler !== undefined && parkingFees.fourWheeler !== null) ? Number(parkingFees.fourWheeler) : (contract.parkingFees?.fourWheeler ?? 5000),
      };
    }
    if (typeof noticePeriodDays !== 'undefined' && noticePeriodDays !== null) contract.noticePeriodDays = Number(noticePeriodDays);
    if (typeof escalationRatePercentage !== 'undefined' && escalationRatePercentage !== null) contract.escalationRatePercentage = Number(escalationRatePercentage);
    if (escalation && typeof escalation === 'object') contract.escalation = escalation;
    if (renewal && typeof renewal === 'object') contract.renewal = renewal;
    if (fullyServicedBusinessHours && typeof fullyServicedBusinessHours === 'object') contract.fullyServicedBusinessHours = fullyServicedBusinessHours;
    if (Array.isArray(freebies)) contract.freebies = freebies;
    if (payAsYouGo && typeof payAsYouGo === 'object') contract.payAsYouGo = payAsYouGo;
    if (typeof cleaningAndRestorationFees !== 'undefined' && cleaningAndRestorationFees !== null) contract.cleaningAndRestorationFees = Number(cleaningAndRestorationFees);

    // Only keep clientAcceptance when updating acceptance
    if (termsAndConditionAcceptance && typeof termsAndConditionAcceptance === 'object' && termsAndConditionAcceptance.clientAcceptance) {
      contract.termsAndConditionAcceptance = {
        ...(contract.termsAndConditionAcceptance || {}),
        clientAcceptance: termsAndConditionAcceptance.clientAcceptance,
      };
    }

    // Recompute duration months if dates provided
    try {
      if (contract.startDate && contract.endDate) {
        const sd = new Date(contract.startDate);
        const ed = new Date(contract.endDate);
        let months = (ed.getFullYear() - sd.getFullYear()) * 12 + (ed.getMonth() - sd.getMonth());
        if (ed.getDate() >= sd.getDate()) months += 1;
        contract.durationMonths = Math.max(0, months);
        // Commencement date should mirror start date
        contract.commencementDate = contract.startDate;
        // Lock-in can be overridden, otherwise default to duration
        if (typeof lockInPeriodMonths !== 'undefined' && lockInPeriodMonths !== null) {
          contract.lockInPeriodMonths = Number(lockInPeriodMonths);
        } else {
          contract.lockInPeriodMonths = contract.durationMonths;
        }
      }
    } catch (_) { }

    // monthlyRent: if provided, validate and set; otherwise derive from Building perSeatPricing
    if (typeof monthlyRent !== 'undefined' && monthlyRent !== null && monthlyRent !== "") {
      const mr = Number(monthlyRent);
      if (Number.isNaN(mr) || mr < 0) {
        return res.status(400).json({ success: false, message: "monthlyRent must be a non-negative number" });
      }
      contract.monthlyRent = mr;
    } else {
      try {
        const buildingIdToUse = building || contract.building;
        const capToUse = Number(contract.capacity) || 0;
        const buildingDoc = await Building.findById(buildingIdToUse).select('perSeatPricing status');
        if (!buildingDoc) {
          return res.status(404).json({ success: false, message: "Building not found for rent derivation" });
        }
        if (buildingDoc.status && String(buildingDoc.status).toLowerCase() !== 'active') {
          return res.status(400).json({ success: false, message: "Building is not active" });
        }
        if (buildingDoc.perSeatPricing == null || buildingDoc.perSeatPricing < 0) {
          return res.status(400).json({ success: false, message: "Building per seat pricing is not configured" });
        }
        contract.monthlyRent = Number(buildingDoc.perSeatPricing) * capToUse;
      } catch (bErr) {
        console.warn('salesEditCommercials: failed to derive monthlyRent from building', bErr?.message || bErr);
        return res.status(400).json({ success: false, message: "Unable to derive monthlyRent" });
      }
    }

    // Reset approvals and legal state to force the workflow again
    contract.salesSeniorApproved = false;
    contract.salesSeniorApprovedBy = null;
    contract.salesSeniorApprovedAt = null;
    contract.salesSeniorApprovalNotes = null;

    contract.adminapproved = false;
    contract.clientapproved = false;
    contract.isclientsigned = false;
    contract.iscontractsentforsignature = false;

    // Clear legal upload markers; keep fileUrl placeholder to enforce re-upload
    contract.fileUrl = "placeholder";
    contract.legalUploadedAt = null;
    contract.legalUploadedBy = null;
    contract.legalUploadNotes = null;

    // Clear admin rejection markers if any
    contract.adminRejectedBy = null;
    contract.adminRejectedAt = null;
    contract.adminRejectionReason = undefined;

    // Clear senior rejection markers if any (re-submission)
    contract.rejectedBy = null;
    contract.rejectedAt = null;
    contract.rejectionReason = undefined;

    // Reset status back to pushed for senior review
    contract.status = "pushed";

    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    // If building changed, update client's building reference
    try {
      if (client && building && originalBuilding !== String(building)) {
        await Client.findByIdAndUpdate(client, { building }, { new: true });
      }
    } catch (e) {
      console.warn("Failed to update client building on sales edit:", e?.message);
    }

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "sales_updated_commercials",
    });

    return res.json({ success: true, message: "Commercials updated and resubmitted for Sales Senior review" });
  } catch (err) {
    console.error("salesEditCommercials error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Edit Commercials");
    return res.status(500).json({ success: false, message: "Failed to update commercials" });
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

    // If approved by Sales Senior, notify Legal Team to review and finalize
    if (approve) {
      try {
        const populatedForEmail = await Contract.findById(id)
          .populate("client", "companyName email")
          .populate("building", "name");
        const emailResult = await sendLegalReviewRequestEmail(populatedForEmail || contract);
        if (!emailResult?.success) {
          console.warn("Legal review request email failed:", emailResult?.error || emailResult);
        }
      } catch (emailErr) {
        console.warn("Failed to send legal review request email:", emailErr?.message || emailErr);
      }

      // Notify Legal Team users only about legal stage kickoff
      try {
        const populated = await Contract.findById(id).populate("client", "companyName");
        const companyName = populated?.client?.companyName || 'Client';
        const legalRole = await Role.findOne({ roleName: 'Legal Team' }).lean();
        if (!legalRole?._id) {
          console.warn('salesSeniorUpdateAndApprove: Legal Team role not found');
        } else {
          const legalUsers = await User.find({ role: legalRole._id }).select('email _id').lean();
          for (const u of legalUsers) {
            const to = { userId: u._id };
            if (u.email) to.email = u.email;
            await sendNotification({
              to,
              channels: { email: Boolean(to.email), sms: false },
              templateKey: 'legal_team_contract_upload',
              templateVariables: {
                companyName: companyName,
                contractId: String(id)
              },
              title: 'Legal Team Stage Initiated',
              metadata: {
                category: 'contract',
                tags: ['legal_team_contract_upload'],
                route: `/contracts/${id}`,
                deepLink: `ofis://contracts/${id}`,
                routeParams: { id: String(id) }
              },
              source: 'system',
              type: 'transactional'
            });
          }
        }
      } catch (notifyErr) {
        console.warn('salesSeniorUpdateAndApprove: failed to notify Legal Team:', notifyErr?.message || notifyErr);
      }
    }

    return res.json({ success: true, message: approve ? "Approved by Sales Senior" : "Updated by Sales Senior" });
  } catch (err) {
    console.error("salesSeniorUpdateAndApprove error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Senior Update/Approve");
    return res.status(500).json({ success: false, message: "Failed to update/approve" });
  }
};

// Sales Senior rejects with mandatory note
export const salesSeniorReject = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};

    if (!notes || !String(notes).trim()) {
      return res.status(400).json({ success: false, message: "Rejection note is required" });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (contract.salesSeniorApproved) {
      return res.status(400).json({ success: false, message: "Already approved by Sales Senior; cannot reject" });
    }

    // Optional: allow reject only when pending Sales Senior approval
    if ((contract.status || "").toLowerCase() !== "pushed") {
      return res.status(400).json({ success: false, message: "Only contracts pending Sales Senior approval (status: pushed) can be rejected" });
    }

    // Clear any previous approval markers just in case
    contract.salesSeniorApproved = false;
    contract.salesSeniorApprovedBy = null;
    contract.salesSeniorApprovedAt = null;
    contract.salesSeniorApprovalNotes = null;

    // Mark rejection
    contract.rejectedBy = req.user?._id || null;
    contract.rejectedAt = new Date();
    contract.rejectionReason = String(notes).trim();

    // Update status and audit
    contract.status = "sales_senior_rejected";
    contract.lastActionBy = req.user?._id || contract.lastActionBy;
    contract.lastActionAt = new Date();

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "sales_senior_rejected",
      notes: String(notes).trim(),
    });

    // Notify Sales role users about rejection
    try {
      const populatedForNotify = await Contract.findById(id)
        .populate("client", "companyName")
        .populate("building", "name")
        .populate("createdBy", "name email");
      const companyName = populatedForNotify?.client?.companyName || 'Client';
      const buildingName = populatedForNotify?.building?.name || 'Building';
      const salesAssociateName = populatedForNotify?.createdBy?.name || 'Sales Associate';

      const salesRole = await Role.findOne({ roleName: 'Sales' }).lean();
      if (!salesRole?._id) {
        console.warn('salesSeniorReject: Sales role not found');
      } else {
        const salesUsers = await User.find({ role: salesRole._id }).select('email _id').lean();
        for (const u of salesUsers) {
          const to = { userId: u._id };
          if (u.email) to.email = u.email;
          await sendNotification({
            to,
            channels: { email: Boolean(to.email), sms: false },
            templateKey: 'sales_junior_commercials_rejected',
            templateVariables: {
              salesAssociateName,
              building: buildingName,
              companyName,
              reason: String(notes).trim(),
              contractId: String(id)
            },
            title: 'Sales Senior Rejected Commercials',
            metadata: {
              category: 'contract',
              tags: ['sales_junior_commercials_rejected'],
              route: `/contracts/${id}`,
              deepLink: `ofis://contracts/${id}`,
              routeParams: { id: String(id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      }
    } catch (notifyErr) {
      console.warn('salesSeniorReject: failed to notify Sales users:', notifyErr?.message || notifyErr);
    }

    return res.json({ success: true, message: "Rejected by Sales Senior" });
  } catch (err) {
    console.error("salesSeniorReject error:", err);
    await logErrorActivity(req, err, "Custom Flow: Sales Senior Reject");
    return res.status(500).json({ success: false, message: "Failed to reject" });
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

    // Notify System Admin users (role) about next approval step using 'senior_management_contract_approval'
    try {
      const populatedContract = await Contract.findById(id).populate("client", "companyName");
      const companyName = populatedContract?.client?.companyName || 'Client';
      const adminRole = await Role.findOne({ roleName: 'System Admin' }).lean();
      if (!adminRole?._id) {
        console.warn('legalUploadDocument: System Admin role not found');
      } else {
        const adminUsers = await User.find({ role: adminRole._id }).select('email _id name').lean();
        for (const u of adminUsers) {
          const to = { userId: u._id };
          if (u.email) to.email = u.email;
          await sendNotification({
            to,
            channels: { email: Boolean(to.email), sms: false },
            templateKey: 'senior_management_contract_approval',
            templateVariables: {
              managerName: u.name || 'Manager',
              companyName: companyName,
              contractId: String(id)
            },
            title: 'Contract Pending Senior Management Approval',
            metadata: {
              category: 'contract',
              tags: ['senior_management_contract_approval'],
              route: `/contracts/${id}`,
              deepLink: `ofis://contracts/${id}`,
              routeParams: { id: String(id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      }
    } catch (notifyErr) {
      console.warn('legalUploadDocument: failed to notify System Admin users:', notifyErr?.message || notifyErr);
    }

    // Notify System Admins to review and approve the contract
    try {
      const populatedForEmail = await Contract.findById(id)
        .populate("client", "companyName email")
        .populate("building", "name");
      const emailResult = await sendAdminApprovalRequestEmail(populatedForEmail || contract);
      if (!emailResult?.success) {
        console.warn("Admin approval request email failed:", emailResult?.error || emailResult);
      }
    } catch (emailErr) {
      console.warn("Failed to send admin approval request email:", emailErr?.message || emailErr);
    }

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

    const contract = await Contract.findById(id)
      .populate("client")
      .populate("building", "name address pricing");
    if (!contract) return res.status(404).json({ success: false, message: "Contract not found" });

    if (!contract.client) return res.status(400).json({ error: "Contract client not found" });

    // Require an active cabin block for this client in this building before sending for signature
    try {
      const hasActiveBlock = await Cabin.exists({
        building: contract.building,
        "blocks.status": "active",
        "blocks.client": contract.client,
      });
      if (!hasActiveBlock) {
        return res.status(400).json({
          error: "No active cabin block found for this client. Please block a cabin before sending for signature.",
        });
      }
    } catch (blkErr) {
      console.error("Block pre-check failed:", blkErr);
      return res.status(500).json({ error: "Failed to validate cabin block status" });
    }

    // Use stampPaperUrl if available, otherwise fallback to fileUrl
    const documentUrl = contract.stampPaperUrl || contract.fileUrl;
    if (!documentUrl || documentUrl === "placeholder") {
      return res.status(400).json({
        success: false,
        message: "Contract must have a stampPaperUrl or fileUrl before it can be approved. Please generate the contract PDF first."
      });
    }

    // Optional hard role gate: System Admin only
    if (req.user?.role?.roleName !== "System Admin") {
      return res.status(403).json({ success: false, message: "Only System Admin can approve at this stage" });
    }

    contract.adminapproved = true;
    contract.adminApprovalReason = reason || null;
    contract.adminApprovedBy = req.user?._id || null;
    contract.adminApprovedAt = new Date();

    // Keep status as admin_approved per request
    contract.status = "admin_approved";

    // Signature Logic Merged
    try {
      console.log('Sending contract for signature (via admin approve):', {
        contractId: contract._id,
        clientName: contract.client.companyName,
        fileUrl: documentUrl,
        usingStampPaper: !!contract.stampPaperUrl,
        status: contract.status
      });

      const requestId = await loggedZohoSign.createDocument(contract);
      console.log("Document created with request ID:", requestId);

      const documentDetails = await loggedZohoSign.verifyDocumentExists(requestId);
      const documentId = documentDetails?.document_ids?.[0]?.document_id;
      if (!documentId) {
        throw new Error("Failed to get document ID from Zoho Sign");
      }

      const client = contract.client || {};
      let recipient = client;
      if (client && client.isPrimaryContactauthoritySignee === false && client.authoritySignee) {
        const a = client.authoritySignee || {};
        const nameParts = [a.firstName, a.lastName].filter(Boolean);
        const recipient_name = (nameParts.join(' ').trim()) || client.contactPerson || client.companyName || 'Client';
        const recipient_email = a.email || client.email;
        recipient = { contactPerson: recipient_name, email: recipient_email };
      }
      await loggedZohoSign.addRecipient(requestId, recipient, documentId, { clientId: client?._id || contract.client });

      await loggedZohoSign.submitDocument(requestId);
      console.log("Document submitted for signature via admin approve");

      contract.iscontractsentforsignature = true;
      contract.zohoSignRequestId = requestId;
      contract.sentForSignatureAt = new Date();

      await logContractActivity(req, 'CONTRACT_SENT_FOR_SIGNATURE', contract._id, contract.client?._id, {
        zohoSignRequestId: requestId,
        clientEmail: contract.client.email,
        clientName: contract.client.companyName
      });
    } catch (sigErr) {
      console.error("Zoho Sign integration failed during admin approval:", sigErr);
      // We continue with approval even if sign fails?
      // Usually it's better to fail the whole thing if signature is critical.
      // But user said "merge", so I'll throw to catch block if it fails significantly.
      throw new Error(`Signature initiation failed: ${sigErr.message}`);
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

    // Printer credits wallet updates are handled at final approval stage
    if (contract.isfinalapproval) {
      try {
        const targetClient = contract.client;
        if (targetClient) {
          await ClientCreditWallet.findOneAndUpdate(
            { client: targetClient },
            { $set: { printerBalance: contract.printerCredits } },
            { new: true, upsert: true }
          );
        }
      } catch (walletErr) {
        console.warn("adminApproveCustom: failed to update printerBalance:", walletErr?.message || walletErr);
      }
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

    // Try to fetch signed document from Zoho Sign (if we have a request/envelope id)
    try {
      const requestId = contract.zohoSignRequestId || contract.signatureEnvelopeId;
      if (requestId) {
        const accessToken = await getAccessToken();
        const resp = await fetch(`https://sign.zoho.in/api/v1/requests/${requestId}`, {
          method: "GET",
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            "Content-Type": "application/json",
          },
        });
        if (resp.ok) {
          const data = await resp.json();
          const docs = data?.requests?.document_ids || [];
          for (const doc of docs) {
            if (doc?.image_string) {
              contract.fileUrl = `data:image/jpeg;base64,${doc.image_string}`;
              break;
            }
          }
        }
      }
    } catch (signedDocErr) {
      console.warn("clientApproveAndSign: failed to fetch signed document:", signedDocErr?.message || signedDocErr);
    }

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: "client_signed",
    });

    // Auto-create billing document (include deposit like webhook path)
    try {
      const doc = await createBillingDocumentFromContract(contract._id, {
        issueOn: "activation",
        prorate: true,
        includeDeposit: true,
        dueDays: 7,
      });
      if (doc?.deferred) {
        console.log(`Activation billing deferred for contract ${contract._id}: ${doc.reason}`);
      } else {
        console.log(`Auto-created billing doc ${doc._id} (mode=${process.env.BILLING_MODE || 'invoice'}) for contract ${contract._id}`);
      }
    } catch (billingError) {
      console.error("Failed to auto-create billing document:", billingError);
      // Don't fail the contract activation if billing document creation fails
    }

    // Ensure default access policy and grant access ONLY if final approval is true
    let ensuredPolicy = null;
    try {
      const policyResult = await ensureDefaultAccessPolicyForContract(contract._id);
      ensuredPolicy = policyResult?.policy || null;
      if (policyResult?.created || policyResult?.updated) {
        console.log("Default access policy ensured (custom client sign):", {
          client: String(contract.client),
          created: policyResult.created,
          updated: policyResult.updated,
          policyId: ensuredPolicy?._id,
        });
      }
    } catch (policyErr) {
      console.warn("Failed to ensure default access policy on custom client sign:", policyErr?.message);
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
          console.log("Access grants created on custom client sign (final approval):", grantRes);
          try {
            await enforceAccessByInvoices(contract.client);
          } catch (enfErr) {
            console.warn("enforceAccessByInvoices after custom client sign failed:", enfErr?.message);
          }
        } else {
          console.warn("No default access policy available to grant access on custom client sign.");
        }
      } else {
        console.log("Skipping access grants on custom client sign: isfinalapproval is not true.");
      }
    } catch (grantErr) {
      console.warn("Access grant on custom client sign failed:", grantErr?.message);
    }

    // Allocate any active blocked cabins
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
