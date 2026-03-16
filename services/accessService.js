import mongoose from "mongoose";
import crypto from "crypto";
import AccessGrant from "../models/accessGrantModel.js";
import Invoice from "../models/invoiceModel.js";
import AccessAudit from "../models/accessAuditModel.js";
import AccessPoint from "../models/accessPointModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";

const writeAudit = async ({ memberId, clientId, accessGrantId, action, actorType = "SYSTEM", actorId, reason, meta }) => {
  try {
    await AccessAudit.create({ memberId, clientId, accessGrantId, action, actorType, actorId, reason, meta });
  } catch (e) {
    console.warn("AccessAudit failed:", e?.message);
  }
};

export const grantOnContractActivation = async (contract, { policyId, startsAt, endsAt, source = "AUTO_CONTRACT" } = {}) => {
  if (!contract) return { created: 0, errors: [] };
  const clientId = contract.client || contract.clientId;
  let memberIds = [];
  if (Array.isArray(contract.members) && contract.members.length > 0) {
    memberIds = contract.members;
  } else if (clientId) {
    const members = await Member.find({ client: clientId, status: 'active' }).select('_id').lean();
    memberIds = members.map(m => m._id);
  }
  let cabinBoundAccessPointId = null;
  try {
    if (policyId) {
      const policy = await AccessPolicy.findById(policyId).lean();
      if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length > 0) {
        cabinBoundAccessPointId = String(policy.accessPointIds[0]);
      }
    }
  } catch {}

  const results = { created: 0, errors: [] };
  for (const memberId of memberIds) {
    try {
      const now = new Date();
      const longTtlMs = 365 * 24 * 60 * 60 * 1000; // 365 days
      const token = crypto.randomBytes(24).toString("hex");
      const hash = crypto.createHash("sha256").update(String(token)).digest("hex");

      const grant = await AccessGrant.create({
        memberId,
        clientId,
        policyId,
        status: "ACTIVE",
        source,
        startsAt: startsAt ? new Date(startsAt) : now,
        endsAt: endsAt ? new Date(endsAt) : undefined,
        ...(cabinBoundAccessPointId ? { qrBoundAccessPointId: cabinBoundAccessPointId } : {}),
        qrCodeToken: token,
        qrCodeTokenHash: hash,
        qrCodeExpiresAt: endsAt ? new Date(endsAt) : new Date(now.getTime() + longTtlMs),
      });
      await writeAudit({ memberId, clientId, accessGrantId: grant._id, action: "GRANT", actorType: "SYSTEM", meta: { contractId: contract._id, source } });
      results.created += 1;
    } catch (e) {
      results.errors.push({ memberId, error: e?.message || String(e) });
    }
  }
  return results;
};

/** Suspend all ACTIVE grants for a client (e.g., on invoice overdue). */
export const suspendGrantsForClient = async (clientId, reason = "INVOICE_OVERDUE") => {
  if (!clientId) return { updated: 0 };
  // Do not suspend grants explicitly marked to bypass invoice enforcement
  const res = await AccessGrant.updateMany({ clientId, status: "ACTIVE", bypassInvoices: { $ne: true } }, { $set: { status: "SUSPENDED" } });
  // optional: bulk audit (per-grant audits recommended but can be heavy)
  return { updated: res.modifiedCount };
};

/** Resume all SUSPENDED grants for a client (e.g., on invoice paid). */
export const resumeGrantsForClient = async (clientId, reason = "INVOICE_PAID") => {
  if (!clientId) return { updated: 0 };
  const res = await AccessGrant.updateMany({ clientId, status: "SUSPENDED" }, { $set: { status: "ACTIVE" } });
  return { updated: res.modifiedCount };
};

/** Extend a single grant's end date. */
export const extendGrant = async (grantId, endsAt) => {
  const grant = await AccessGrant.findById(grantId);
  if (!grant) throw new Error("Grant not found");
  const end = new Date(endsAt);
  if (grant.startsAt && end <= grant.startsAt) throw new Error("endsAt must be after startsAt");
  grant.endsAt = end;
  await grant.save();
  await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "EXTEND", actorType: "SYSTEM", meta: { endsAt: end } });
  return grant;
};

export const enforceAccessByInvoices = async (clientId) => {
  if (!clientId) return { action: 'ignored', reason: 'no_client' };
  const now = new Date();
  // Find at least one overdue/unpaid invoice
  const overdue = await Invoice.findOne({
    client: clientId,
    due_date: { $lt: now },
    balance: { $gt: 0 }
  }).select('_id').lean();

  if (overdue) {
    // Suspend non-bypass ACTIVE grants
    const res = await suspendGrantsForClient(clientId, 'INVOICE_OVERDUE');
    // Ensure bypassed grants remain ACTIVE (in case they were previously suspended)
    const resumedBypassed = await AccessGrant.updateMany(
      { clientId, bypassInvoices: true, status: 'SUSPENDED' },
      { $set: { status: 'ACTIVE' } }
    );
    // Update Client status to false (suspended)
    await Client.findByIdAndUpdate(clientId, { $set: { membershipStatus: false } });

    return { action: 'suspended', modified: res.updated, bypassResumed: resumedBypassed.modifiedCount };
  } else {
    const res = await resumeGrantsForClient(clientId, 'NO_OVERDUE');
    // Update Client status to true (active)
    await Client.findByIdAndUpdate(clientId, { $set: { membershipStatus: true } });
    return { action: 'resumed', modified: res.updated };
  }
};

export default {
  grantOnContractActivation,
  suspendGrantsForClient,
  resumeGrantsForClient,
  extendGrant,
  enforceAccessByInvoices,
};
