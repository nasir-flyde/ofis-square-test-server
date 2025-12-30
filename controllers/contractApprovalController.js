import mongoose from "mongoose";
import Contract from "../models/contractModel.js";
import Cabin from "../models/cabinModel.js";
import { logContractActivity, logErrorActivity } from "../utils/activityLogger.js";
import imagekit from "../utils/imageKit.js";
import { ensureDefaultAccessPolicyForContract } from "../services/accessPolicyService.js";
import { grantOnContractActivation } from "../services/accessService.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import Client from "../models/clientModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import Member from "../models/memberModel.js";
import AccessPoint from "../models/accessPointModel.js";
import ProvisioningJob from "../models/provisioningJobModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import { matrixApi } from "../utils/matrixApi.js";
import { ensureBhaifiForMember } from "../controllers/bhaifiController.js";
import Invoice from "../models/invoiceModel.js";
import {
  sendAdminApprovalRequestEmail,
  sendAdminApprovalConfirmationEmail,
  sendClientReviewRequestEmail,
  sendLegalReviewRequestEmail,
  sendContractCommentEmail,
  sendContractSentForSignatureEmail,
  sendContractSignedEmail
} from "../utils/contractEmailService.js";
import DocumentEntity from "../models/documentEntityModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";

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

// Final Approval - requires KYC approved and all invoices fully paid
export const finalApprove = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved = true, reason } = req.body || {};

    const contract = await Contract.findById(id);
    if (!contract) {
      return res
        .status(404)
        .json({ success: false, message: "Contract not found" });
    }

    // // Validation: require KYC approved and all invoices fully paid
    // if (!contract.iskycapproved) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "KYC must be approved before final approval",
    //   });
    // }
    try {
      const unpaidCount = await Invoice.countDocuments({
        contract: contract._id,
        type: 'regular',
        status: { $nin: ["paid", "void"] },
        balance: { $gt: 0 },
      });
      if (unpaidCount > 0) {
        return res.status(400).json({
          success: false,
          message: "Final approval not ready. Ensure all invoices are fully paid.",
        });
      }
    } catch (invErr) {
      console.warn("Invoice validation failed during final approval:", invErr?.message);
      return res.status(500).json({
        success: false,
        message: "Failed to validate invoice payment status",
      });
    }

    // Set final approval metadata
    const wasAlreadyFinal = !!contract.isfinalapproval;
    contract.finalApprovedBy = approved ? req.user?.id || null : null;
    contract.finalApprovedAt = approved ? new Date() : null;
    contract.finalApprovalReason = reason || null;

    // Set isfinalapproval flag to true when approved
    if (approved) {
      contract.isfinalapproval = true;
    }

    await contract.save();

    await logContractActivity(req, "UPDATE", id, contract.client, {
      action: approved ? "final_approved" : "final_rejected",
      approved,
      reason,
    });

    // On final approval, ensure default access policy and grant access, then enforce invoice-based access
    if (approved) {
      // Add allocated credits to client's wallet (general + printer) at final approval only (first time)
      try {
        if (!wasAlreadyFinal) {
          const inc = {};
          const initial = Number.isInteger(contract.initialCredits) && contract.initialCredits > 0 ? contract.initialCredits : 0;
          const printer = Number.isInteger(contract.printerCredits) && contract.printerCredits > 0 ? contract.printerCredits : 0;
          if (initial > 0) inc.balance = initial;
          if (printer > 0) inc.printerBalance = printer;
          if (Object.keys(inc).length > 0) {
            await ClientCreditWallet.findOneAndUpdate(
              { client: contract.client },
              {
                $setOnInsert: {
                  balance: 0,
                  creditValue: 500,
                  currency: "INR",
                  status: "active",
                  printerBalance: 0,
                  printerCreditValue: 1,
                },
                $inc: inc,
              },
              { new: true, upsert: true }
            );
            await logContractActivity(req, "UPDATE", id, contract.client, {
              action: "wallet_credited_on_final_approval",
              addedBalance: initial || 0,
              addedPrinterBalance: printer || 0,
            });
          }
        }
      } catch (walletErr) {
        console.warn("finalApprove: failed to update client wallet:", walletErr?.message || walletErr);
      }

      // Sync parking spaces from contract to client
      try {
        const two = Number(contract?.parkingSpaces?.noOf2WheelerParking) || 0;
        const four = Number(contract?.parkingSpaces?.noOf4WheelerParking) || 0;
        await Client.findByIdAndUpdate(
          contract.client,
          { $set: { 'parkingSpaces.noOf2WheelerParking': two, 'parkingSpaces.noOf4WheelerParking': four } },
          { new: true }
        );
        // Log per parking type with category for filtering
        await logContractActivity(req, 'UPDATE', contract._id, contract.client, {
          category: 'parking',
          parkingType: 'two_wheeler',
          action: 'client_parking_updated_from_contract',
          newValue: two,
        });
        await logContractActivity(req, 'UPDATE', contract._id, contract.client, {
          category: 'parking',
          parkingType: 'four_wheeler',
          action: 'client_parking_updated_from_contract',
          newValue: four,
        });
      } catch (e) {
        console.warn('Failed to sync client parking info on final approval:', e?.message);
      }

      let ensuredPolicy = null;

      // 1. Ensure default access policy for this contract
      try {
        const policyResult = await ensureDefaultAccessPolicyForContract(
          contract._id
        );
        ensuredPolicy = policyResult?.policy || null;
        if (policyResult?.created || policyResult?.updated) {
          console.log("Default access policy ensured (final approve):", {
            client: String(contract.client),
            created: policyResult.created,
            updated: policyResult.updated,
            policyId: ensuredPolicy?._id,
          });
        }
      } catch (policyErr) {
        console.warn(
          "Failed to ensure default access policy on final approval:",
          policyErr?.message
        );
      }
      try {
        // Fallback: create default building-scoped policy directly if not available
        if (!ensuredPolicy?._id) {
          let buildingId = null;
          try {
            const cli = await Client.findById(contract.client)
              .select("building")
              .lean();
            buildingId = cli?.building || null;
          } catch {}

          ensuredPolicy = await AccessPolicy.create({
            buildingId,
            name: "Default Access",
            description: `Auto-created at final approval for contract ${contract._id}`,
            accessPointIds: [],
            isDefaultForBuilding: true,
            ...(contract.startDate || contract.commencementDate
              ? { effectiveFrom: contract.startDate || contract.commencementDate }
              : {}),
            ...(contract.endDate ? { effectiveTo: contract.endDate } : {}),
          });
          console.log(
            "Created default building access policy directly (final approval):",
            ensuredPolicy?._id
          );
        }

        // Attach allocated cabins' devices to policy by mapping to AccessPoints (meeting rooms handled manually later)
        try {
          const allocatedCabins = await Cabin.find({
            contract: contract._id,
            allocatedTo: contract.client,
          })
            .select("_id matrixDevices building")
            .lean();

          if (Array.isArray(allocatedCabins) && allocatedCabins.length > 0) {
            // If policy buildingId is missing, derive from allocated cabins
            if (!ensuredPolicy.buildingId) {
              const derivedBuildingId = allocatedCabins[0]?.building || null;
              if (derivedBuildingId) {
                ensuredPolicy.buildingId = derivedBuildingId;
                await ensuredPolicy.save();
              }
            }

            const apIdSet = new Set();

            // First pass: per allocated cabin, ensure/find APs for its Matrix devices
            for (const c of allocatedCabins) {
              for (const did of c.matrixDevices || []) {
                let ap = await AccessPoint.findOne({
                  buildingId: ensuredPolicy.buildingId || c.building,
                  "deviceBindings.deviceId": did,
                })
                  .select("_id")
                  .lean();

                if (!ap) {
                  const nameSuffix = String(did).slice(-6);
                  const createdAp = await AccessPoint.create({
                    buildingId: ensuredPolicy.buildingId || c.building,
                    name: `AP ${nameSuffix}`,
                    bindingType: "cabin",
                    resource: {
                      refType: "Cabin",
                      refId: c._id,
                      label: String(c._id),
                    },
                    pointType: "DOOR",
                    deviceBindings: [
                      {
                        vendor: "MATRIX_COSEC",
                        deviceId: did,
                        direction: "BIDIRECTIONAL",
                      },
                    ],
                    status: "active",
                  });
                  apIdSet.add(String(createdAp._id));
                } else {
                  apIdSet.add(String(ap._id));
                }
              }
            }

            // Fallback: if none from allocated cabins, look at active/allocated blocks
            if (apIdSet.size === 0) {
              try {
                const blockFilteredCabins = await Cabin.find({
                  "blocks.contract": contract._id,
                  "blocks.status": { $in: ["active", "allocated"] },
                })
                  .select("_id matrixDevices building")
                  .lean();

                for (const c of blockFilteredCabins || []) {
                  for (const did of c.matrixDevices || []) {
                    let ap = await AccessPoint.findOne({
                      buildingId: ensuredPolicy.buildingId || c.building,
                      "deviceBindings.deviceId": did,
                    })
                      .select("_id")
                      .lean();

                    if (!ap) {
                      const nameSuffix = String(did).slice(-6);
                      const createdAp = await AccessPoint.create({
                        buildingId: ensuredPolicy.buildingId || c.building,
                        name: `AP ${nameSuffix}`,
                        bindingType: "cabin",
                        resource: {
                          refType: "Cabin",
                          refId: c._id,
                          label: String(c._id),
                        },
                        pointType: "DOOR",
                        deviceBindings: [
                          {
                            vendor: "MATRIX_COSEC",
                            deviceId: did,
                            direction: "BIDIRECTIONAL",
                          },
                        ],
                        status: "active",
                      });
                      apIdSet.add(String(createdAp._id));
                    } else {
                      apIdSet.add(String(ap._id));
                    }
                  }
                }
              } catch (blkErr) {
                console.warn(
                  "Failed to fetch cabins by active blocks for policy APs:",
                  blkErr?.message
                );
              }
            }

            if (apIdSet.size > 0) {
              const objectIdList = Array.from(apIdSet).map(
                (id) => new mongoose.Types.ObjectId(id)
              );
              const upd = await AccessPolicy.updateOne(
                { _id: ensuredPolicy._id },
                { $addToSet: { accessPointIds: { $each: objectIdList } } }
              );
              console.log("AccessPolicy AP attach result:", {
                matched: upd.matchedCount,
                modified: upd.modifiedCount,
                added: objectIdList.length,
              });
            }
          } else {
            console.log(
              "No allocated cabins found to attach to access policy for this contract."
            );
          }
        } catch (attachErr) {
          console.warn(
            "Failed to attach cabin AccessPoints to access policy:",
            attachErr?.message
          );
        }

        // Shared list of members used for both provisioning and WiFi setup
        let membersForJobs = [];
        const grantRes = await grantOnContractActivation(contract, {
          policyId: ensuredPolicy._id,
          startsAt: contract.startDate || contract.commencementDate || new Date(),
          endsAt: contract.endDate || undefined,
          source: "AUTO_CONTRACT",
        });
        console.log("Access grants created on final approval:", grantRes);

        // Enqueue MATRIX_COSEC UPSERT_USER jobs for all active members of this client
        try {
          let buildingIdForJobs = ensuredPolicy?.buildingId || null;
          if (!buildingIdForJobs) {
            try {
              const cliForJobs = await Client.findById(contract.client)
                .select("building")
                .lean();
              buildingIdForJobs = cliForJobs?.building || null;
            } catch {}
          }

          membersForJobs = await Member.find({
            client: contract.client,
            status: "active",
          })
            .select("_id firstName lastName email phone")
            .lean();

          for (const m of membersForJobs || []) {
            try {
              // Ensure matrixUserId is available for both API call and job payload
              let matrixUserId;

              // Best-effort direct call to Matrix to create/upsert user
              try {
                const random6 = Math.floor(100000 + Math.random() * 900000);
                matrixUserId = `MEM${random6}`;
                await matrixApi.createUser({
                  id: matrixUserId,
                  name:
                    m.firstName || m.lastName
                      ? `${m.firstName || ""} ${m.lastName || ""}`.trim()
                      : undefined,
                  email: m.email || undefined,
                  phone: m.phone || undefined,
                  status: "active",
                  contractEndDate: contract.endDate || undefined,
                });
              } catch (apiErr) {
                console.warn(
                  "Matrix createUser failed for member",
                  String(m._id),
                  apiErr?.message
                );
                // Ensure we still have an ID to queue in the job if API call failed early
                if (!matrixUserId) {
                  const fallbackRand = Math.floor(100000 + Math.random() * 900000);
                  matrixUserId = `MEM${fallbackRand}`;
                }
              }

              // Upsert a MatrixUser record in DB and attach memberId, clientId, buildingId
              try {
                const fullName =
                  (m.firstName || m.lastName)
                    ? `${m.firstName || ""} ${m.lastName || ""}`.trim()
                    : (m.email || m.phone || "Unnamed");

                await MatrixUser.findOneAndUpdate(
                  { externalUserId: matrixUserId },
                  {
                    $setOnInsert: {
                      externalUserId: matrixUserId,
                      name: fullName,
                      email: m.email || undefined,
                      phone: m.phone || undefined,
                      status: "active",
                    },
                    $set: {
                      buildingId: buildingIdForJobs || undefined,
                      clientId: contract.client,
                      memberId: m._id,
                      ...(ensuredPolicy?._id ? { policyId: ensuredPolicy._id } : {}),
                    },
                  },
                  { upsert: true, new: true }
                );
              } catch (e) {
                console.warn(
                  "MatrixUser upsert failed for member",
                  String(m._id),
                  e?.message
                );
              }

              // Attach Matrix references on Member (matrixUser, matrixExternalUserId)
              try {
                const mu = await MatrixUser.findOne({ externalUserId: matrixUserId, memberId: m._id })
                  .select("_id externalUserId")
                  .lean();
                if (mu?._id) {
                  await Member.findByIdAndUpdate(m._id, {
                    $set: { matrixUser: mu._id, matrixExternalUserId: mu.externalUserId },
                  });
                }
              } catch (e) {
                console.warn(
                  "Failed to attach Matrix refs to member",
                  String(m._id),
                  e?.message
                );
              }

              // Also enqueue a job so the background worker can reconcile/retry
              await ProvisioningJob.create({
                vendor: "MATRIX_COSEC",
                jobType: "UPSERT_USER",
                buildingId: buildingIdForJobs,
                memberId: m._id,
                payload: {
                  externalUserId: matrixUserId,
                  name:
                    m.firstName || m.lastName
                      ? `${m.firstName || ""} ${m.lastName || ""}`.trim()
                      : undefined,
                  email: m.email || undefined,
                  phone: m.phone || undefined,
                  status: "active",
                  source: "AUTO_CONTRACT_FINAL_APPROVE",
                  contractEndDate: contract.endDate || undefined,
                },
              });

              // Mirror createMatrixUser: assign user to devices derived from ensuredPolicy access points
              try {
                let assignedCount = 0;
                const polId = ensuredPolicy?._id;
                if (polId) {
                  const policyDoc = await AccessPolicy.findById(polId)
                    .select('accessPointIds')
                    .lean();
                  if (policyDoc?.accessPointIds?.length) {
                    const aps = await AccessPoint.find({ _id: { $in: policyDoc.accessPointIds } })
                      .select('deviceBindings')
                      .lean();
                    const devObjIds = [];
                    for (const ap of aps) {
                      const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
                      for (const b of bindings) {
                        if (b?.vendor === 'MATRIX_COSEC' && b?.deviceId) {
                          devObjIds.push(String(b.deviceId));
                        }
                      }
                    }
                    const uniqueDevObjIds = Array.from(new Set(devObjIds));
                    if (uniqueDevObjIds.length) {
                      const devs = await MatrixDevice.find({ _id: { $in: uniqueDevObjIds } })
                        .select('device_id')
                        .lean();
                      for (const d of devs) {
                        const device_id = d?.device_id;
                        if (!device_id) continue;
                        try {
                          const assignRes = await matrixApi.assignUserToDevice({ device_id, externalUserId: matrixUserId });
                          if (assignRes?.ok) assignedCount += 1;
                        } catch (e) {
                          await logErrorActivity(req, e, 'FinalApprove:DeviceAssign', { memberId: m._id, externalUserId: matrixUserId, device_id });
                        }
                      }
                    }
                  }
                }
                if (assignedCount > 0) {
                  await MatrixUser.findOneAndUpdate(
                    { externalUserId: matrixUserId },
                    { $set: { isDeviceAssigned: true, isEnrolled: true, ...(ensuredPolicy?._id ? { policyId: ensuredPolicy._id } : {}) } }
                  );
                  await logContractActivity(req, 'UPDATE', contract._id, contract.client, {
                    action: 'matrix_user_assigned_to_devices',
                    memberId: String(m._id),
                    externalUserId: matrixUserId,
                    assignedDevices: assignedCount,
                    policyId: ensuredPolicy?._id ? String(ensuredPolicy._id) : null,
                  });
                }
              } catch (e) {
                console.warn('FinalApprove device assignment failed:', e?.message);
              }
            } catch (jobErr) {
              console.warn(
                "Failed to enqueue UPSERT_USER job for member",
                String(m._id),
                jobErr?.message
              );
            }
          }

          await logContractActivity(req, 'UPDATE', contract._id, contract.client, {
            action: 'matrix_upsert_user_jobs_enqueued',
            count: (membersForJobs || []).length,
          });
        } catch (provErr) {
          console.warn("Matrix UPSERT_USER enqueue failed:", provErr?.message);
        }

        // WiFi provisioning (Bhaifi) for all active members of this client
        try {
          const wifiProvisioned = [];
          for (const m of membersForJobs || []) {
            try {
              const bhaifiDoc = await ensureBhaifiForMember({ memberId: m._id, contractId: contract._id });
              wifiProvisioned.push(String(m._id));

              // Attach Bhaifi references on Member (bhaifiUser, bhaifiUserName)
              try {
                if (bhaifiDoc?._id) {
                  await Member.findByIdAndUpdate(m._id, {
                    $set: { bhaifiUser: bhaifiDoc._id, bhaifiUserName: bhaifiDoc.userName },
                  });
                }
              } catch (e) {
                console.warn(
                  "Failed to attach Bhaifi refs to member",
                  String(m._id),
                  e?.message
                );
              }
            } catch (e) {
              await logErrorActivity(req, e, 'FinalApprove:BhaifiProvision', { memberId: String(m._id) });
            }
          }
          await logContractActivity(req, 'UPDATE', contract._id, contract.client, {
            action: 'bhaifi_wifi_provisioned',
            count: wifiProvisioned.length,
          });
        } catch (wifiErr) {
          console.warn('Bhaifi auto-provisioning failed:', wifiErr?.message);
        }
      } catch (grantErr) {
        console.warn("Access grant on final approval failed:", grantErr?.message);
      }
    }

    return res.json({
      success: true,
      message: `Contract ${approved ? "approved" : "rejected"} successfully`,
      data: {
        id: contract._id,
        finalApprovedBy: contract.finalApprovedBy,
        finalApprovedAt: contract.finalApprovedAt,
        finalApprovalReason: contract.finalApprovalReason,
        isfinalapproval: contract.isfinalapproval,
      },
    });
  } catch (error) {
    console.error("Error in final approval:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process final approval",
      error: error.message,
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
    contract.financeApprovedBy = approved ? req.user?.id || null : null;
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

// Helper to load active KYC document entities
const getKycDocEntities = async () => {
  const docs = await DocumentEntity.find({
    isActive: true,
  }).select("_id fieldName name required entityType").lean();
  const byField = new Map(docs.map((d) => [d.fieldName, d]));
  return { list: docs, byField };
};

export const approveKYC = async (req, res) => {
  try {
    const { id } = req.params;

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    // Evaluate only required docs; optional (required: false) must not block approval
    const requiredDocs = await DocumentEntity.find({
      isActive: true,
      required: true,
      entityType: { $in: ['contract', 'both'] },
    }).select('_id fieldName name').lean();

    const items = Array.isArray(contract.kycDocumentItems) ? contract.kycDocumentItems : [];

    if (requiredDocs.length > 0) {
      // Ensure at least one KYC document is uploaded when there are required docs
      const anyUploaded = items.some(i => !!i.url);
      if (!contract.iskycuploaded || !anyUploaded) {
        return res.status(400).json({ success: false, message: 'KYC documents must be uploaded before approval' });
      }

      const missing = [];

      // Approve any required doc items that are uploaded but not yet approved
      for (const rd of requiredDocs) {
        const hasItem = items.find((it) => {
          const matchesById = it.document && String(it.document) === String(rd._id);
          const matchesByField = it.fieldName && it.fieldName === rd.fieldName;
          return (matchesById || matchesByField) && !!it.url;
        });
        if (!hasItem) {
          missing.push(rd.name || rd.fieldName || String(rd._id));
        }
      }

      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required KYC documents: ${missing.join(', ')}`,
          missingRequired: missing,
        });
      }

      // Auto-mark uploaded required items as approved to align with pre-save hook logic
      contract.kycDocumentItems = items.map((it) => {
        const isRequired = requiredDocs.some((rd) => {
          const matchesById = it.document && String(it.document) === String(rd._id);
          const matchesByField = it.fieldName && it.fieldName === rd.fieldName;
          return matchesById || matchesByField;
        });
        if (isRequired && it.url && !it.approved) {
          return { ...it, approved: true, approvedBy: req.user?.id || null };
        }
        return it;
      });
    }

    // Mark KYC as approved (pre-save hook will also verify required approvals)
    contract.iskycapproved = true;
    contract.kycApprovedAt = new Date();
    contract.kycApprovedBy = req.user?.id || null;
    await contract.save();

    // Log activity
    await logContractActivity(req, 'UPDATE', id, contract.client, {
      action: 'kyc_approved',
      approvedBy: req.user?.id || null,
      documentsCount: Array.isArray(contract.kycDocumentItems) ? contract.kycDocumentItems.length : 0,
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

export const uploadKYCDocumentByType = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const file = req.file;

    const { byField } = await getKycDocEntities();
    if (!byField.has(docType)) {
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

    const entity = byField.get(docType);
    const items = Array.isArray(contract.kycDocumentItems) ? contract.kycDocumentItems : [];
    const idx = items.findIndex(it => (it.document && String(it.document) === String(entity._id)) || it.fieldName === docType);
    const newItem = {
      document: entity._id,
      fieldName: docType,
      fileName: file.originalname,
      url: uploadResponse.url,
      approved: false,
      approvedBy: null,
      uploadedAt: new Date(),
    };
    if (idx >= 0) items[idx] = { ...items[idx], ...newItem };
    else items.push(newItem);
    contract.kycDocumentItems = items;
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

export const approveKYCDocumentByType = async (req, res) => {
  try {
    const { id, docType } = req.params;
    const { byField } = await getKycDocEntities();
    if (!byField.has(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC document type' });
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    const entity = byField.get(docType);
    const item = (contract.kycDocumentItems || []).find(it => (it.document && String(it.document) === String(entity._id)) || it.fieldName === docType);
    if (!item || !item.url) {
      return res.status(400).json({ success: false, message: 'Document not uploaded yet' });
    }

    contract.kycDocumentItems = (contract.kycDocumentItems || []).map(it => {
      const matches = (it.document && String(it.document) === String(entity._id)) || it.fieldName === docType;
      return matches ? { ...it, approved: true, approvedBy: req.user?.id || null } : it;
    });
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
    const { byField } = await getKycDocEntities();
    for (const dt of docTypes) {
      if (!byField.has(dt)) {
        return res.status(400).json({ success: false, message: `Invalid KYC document type: ${dt}` });
      }
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    contract.kycDocumentItems = contract.kycDocumentItems || [];

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

      const entity = byField.get(docType);
      const idx = contract.kycDocumentItems.findIndex(it => (it.document && String(it.document) === String(entity._id)) || it.fieldName === docType);
      const newItem = {
        document: entity._id,
        fieldName: docType,
        fileName: file.originalname,
        url: uploadResponse.url,
        approved: false,
        approvedBy: null,
        uploadedAt: new Date(),
      };
      if (idx >= 0) contract.kycDocumentItems[idx] = { ...contract.kycDocumentItems[idx], ...newItem };
      else contract.kycDocumentItems.push(newItem);

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
      docTypes = (contractForScan.kycDocumentItems || []).filter(i => i.url).map(i => i.fieldName).filter(Boolean);
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

    const { byField } = await getKycDocEntities();
    for (const dt of docTypes) {
      if (!byField.has(dt)) {
        return res.status(400).json({ success: false, message: `Invalid KYC document type: ${dt}` });
      }
    }

    const contract = await Contract.findById(id);
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contract not found' });
    }

    const approvedDocTypes = [];
    const skipped = [];

    for (const dt of docTypes) {
      const item = (contract.kycDocumentItems || []).find(it => it.fieldName === dt || (it.document && byField.get(dt) && String(it.document) === String(byField.get(dt)._id)));
      if (!item || !item.url) {
        skipped.push({ docType: dt, reason: 'Document not uploaded' });
        continue;
      }
      contract.kycDocumentItems = (contract.kycDocumentItems || []).map(it => (it.fieldName === dt || (it.document && byField.get(dt) && String(it.document) === String(byField.get(dt)._id)))
        ? { ...it, approved: true, approvedBy: req.user?.id || null }
        : it);
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
