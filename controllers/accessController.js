import mongoose from "mongoose";
import crypto from "crypto";
import AccessPolicy from "../models/accessPolicyModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import AccessGrant from "../models/accessGrantModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessAudit from "../models/accessAuditModel.js";
import Cabin from "../models/cabinModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { enforceAccessByInvoices } from "../services/accessService.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const parseTimeHHMM = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
};

// List access policies for admin UI (optional client filter)
export const listAccessPolicies = async (req, res) => {
  try {
    const { buildingId, clientId, page = 1, limit = 200 } = req.query || {};
    const filter = {};
    let resolvedBuildingId = buildingId;
    // Backward-compat: accept clientId and map to its building
    if (!resolvedBuildingId && clientId) {
      try {
        const cli = await Client.findById(clientId).select('building').lean();
        if (cli?.building) resolvedBuildingId = String(cli.building);
      } catch {}
    }
    if (resolvedBuildingId) filter.buildingId = resolvedBuildingId;
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AccessPolicy.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('name buildingId accessPointIds effectiveFrom effectiveTo isDefaultForBuilding')
        .lean(),
      AccessPolicy.countDocuments(filter)
    ]);
    return res.json({ success: true, data: items, pagination: { currentPage: Number(page)||1, totalPages: Math.ceil(total/Number(limit||1)), totalRecords: total } });
  } catch (err) {
    console.error('listAccessPolicies error:', err);
    await logErrorActivity(req, err, 'Access:Policies:List');
    return res.status(500).json({ success: false, message: 'Failed to list policies' });
  }
};

// Create access policy for admin UI
export const createAccessPolicy = async (req, res) => {
  try {
    const {
      buildingId,
      name,
      description,
      accessPointIds = [],
      allowedFromTime,
      allowedToTime,
      isDefaultForBuilding = false,
      effectiveFrom,
      effectiveTo,
      cabinId,
    } = req.body || {};

    if (!buildingId || !mongoose.Types.ObjectId.isValid(buildingId)) {
      return res.status(400).json({ success: false, message: "Valid buildingId is required" });
    }
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Policy name is required" });
    }

    // Validate daily window, if provided
    if (allowedFromTime && !parseTimeHHMM(allowedFromTime)) {
      return res.status(400).json({ success: false, message: "allowedFromTime must be in HH:MM format" });
    }
    if (allowedToTime && !parseTimeHHMM(allowedToTime)) {
      return res.status(400).json({ success: false, message: "allowedToTime must be in HH:MM format" });
    }

    // Build and normalize access points list
    let points = [];
    if (cabinId) {
      const cabin = await Cabin.findById(cabinId).select('building matrixDevices').lean();
      if (!cabin) {
        return res.status(404).json({ success: false, message: 'Cabin not found' });
      }
      if (String(cabin.building) !== String(buildingId)) {
        return res.status(400).json({ success: false, message: 'Cabin must belong to the same building as the policy' });
      }
      points = (cabin.matrixDevices || []).map((id) => String(id));
    } else {
      const raw = Array.isArray(accessPointIds) ? accessPointIds.map((p) => String(p).trim()).filter(Boolean) : [];
      const idRegex = /^[a-f\d]{24}$/i;
      const deviceRegex = /^MATRIX_DEVICE:([a-f\d]{24})$/i;
      const cabinRegex = /^CABIN:([a-f\d]{24})$/i;

      const matrixIds = [];
      const cabinIds = [];
      for (const token of raw) {
        const mDev = token.match(deviceRegex);
        const mCab = token.match(cabinRegex);
        if (mDev) {
          matrixIds.push(mDev[1]);
        } else if (mCab) {
          cabinIds.push(mCab[1]);
        } else if (idRegex.test(token)) {
          matrixIds.push(token);
        } else {
          return res.status(400).json({ success: false, message: "accessPointIds must be MatrixDevice ObjectIds, 'MATRIX_DEVICE:<id>' or 'CABIN:<id>'" });
        }
      }

      if (cabinIds.length) {
        const cabins = await Cabin.find({ _id: { $in: cabinIds } }).select('building matrixDevices').lean();
        const found = new Set(cabins.map(c => String(c._id)));
        const missing = cabinIds.filter(id => !found.has(String(id)));
        if (missing.length) {
          return res.status(400).json({ success: false, message: `Unknown cabins: ${missing.join(', ')}` });
        }
        const invalidCabins = cabins.filter(c => String(c.building) !== String(buildingId));
        if (invalidCabins.length) {
          return res.status(400).json({ success: false, message: 'All cabins must belong to the same building as the policy' });
        }
        for (const c of cabins) {
          for (const did of (c.matrixDevices || [])) matrixIds.push(String(did));
        }
      }

      // dedupe
      points = Array.from(new Set(matrixIds));
    }

    // Extract matrix device ids for validation
    const idRegex = /^[a-f\d]{24}$/i;
    const matrixIds = points.filter((p) => idRegex.test(p));
    if (matrixIds.length > 0) {
      const devices = await MatrixDevice.find({ _id: { $in: matrixIds } }).select('_id buildingId status').lean();
      const foundIds = new Set(devices.map(d => String(d._id)));
      const missing = matrixIds.filter(id => !foundIds.has(String(id)));
      if (missing.length) {
        return res.status(400).json({ success: false, message: `Unknown Matrix devices: ${missing.join(', ')}` });
      }
      const invalid = devices.filter(d => String(d.buildingId) !== String(buildingId));
      if (invalid.length) {
        return res.status(400).json({ success: false, message: `Matrix devices must belong to the same building as the policy` });
      }
      const inactive = devices.filter(d => d.status !== 'active');
      if (inactive.length) {
        return res.status(400).json({ success: false, message: `Matrix devices must be active to be added to a policy` });
      }
    }

    const payload = {
      buildingId,
      name: name.trim(),
      ...(description ? { description } : {}),
      accessPointIds: points,
      ...(allowedFromTime ? { allowedFromTime } : {}),
      ...(allowedToTime ? { allowedToTime } : {}),
      ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom) } : {}),
      ...(effectiveTo ? { effectiveTo: new Date(effectiveTo) } : {}),
      isDefaultForBuilding: Boolean(isDefaultForBuilding),
    };

    // If marking as default, clear any existing default for this building first
    if (payload.isDefaultForBuilding) {
      await AccessPolicy.updateMany(
        { buildingId, isDefaultForBuilding: true },
        { $set: { isDefaultForBuilding: false } }
      );
    }

    const created = await AccessPolicy.create(payload);
    await logCRUDActivity(req, "CREATE", "AccessPolicy", created._id, null, { buildingId, name: created.name });

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('createAccessPolicy error:', err);
    await logErrorActivity(req, err, 'Access:Policies:Create');
    return res.status(500).json({ success: false, message: 'Failed to create policy' });
  }
};

// Update access policy (supports updating accessPointIds with MATRIX_DEVICE validation)
export const updateAccessPolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await AccessPolicy.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Policy not found' });

    const {
      buildingId,
      name,
      description,
      accessPointIds,
      allowedFromTime,
      allowedToTime,
      isDefaultForBuilding,
      effectiveFrom,
      effectiveTo,
      cabinId,
    } = req.body || {};

    const targetBuildingId = buildingId || existing.buildingId;
    if (!targetBuildingId || !mongoose.Types.ObjectId.isValid(targetBuildingId)) {
      return res.status(400).json({ success: false, message: 'Valid buildingId is required' });
    }

    if (allowedFromTime && !parseTimeHHMM(allowedFromTime)) {
      return res.status(400).json({ success: false, message: 'allowedFromTime must be in HH:MM format' });
    }
    if (allowedToTime && !parseTimeHHMM(allowedToTime)) {
      return res.status(400).json({ success: false, message: 'allowedToTime must be in HH:MM format' });
    }

    const update = {};
    update.buildingId = targetBuildingId;
    if (typeof name === 'string') update.name = name.trim();
    if (typeof description === 'string') update.description = description;
    if (typeof allowedFromTime === 'string') update.allowedFromTime = allowedFromTime;
    if (typeof allowedToTime === 'string') update.allowedToTime = allowedToTime;
    if (typeof isDefaultForBuilding === 'boolean') update.isDefaultForBuilding = isDefaultForBuilding;
    if (effectiveFrom !== undefined) update.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : undefined;
    if (effectiveTo !== undefined) update.effectiveTo = effectiveTo ? new Date(effectiveTo) : undefined;

    let normalizedPoints = undefined;
    if (cabinId) {
      const cabin = await Cabin.findById(cabinId).select('building matrixDevices').lean();
      if (!cabin) {
        return res.status(404).json({ success: false, message: 'Cabin not found' });
      }
      if (String(cabin.building) !== String(targetBuildingId)) {
        return res.status(400).json({ success: false, message: 'Cabin must belong to the same building as the policy' });
      }
      normalizedPoints = (cabin.matrixDevices || []).map((id) => String(id));
    } else if (Array.isArray(accessPointIds)) {
      const raw = accessPointIds.map((p) => String(p).trim()).filter(Boolean);
      const idRegex = /^[a-f\d]{24}$/i;
      const deviceRegex = /^MATRIX_DEVICE:([a-f\d]{24})$/i;
      const cabinRegex = /^CABIN:([a-f\d]{24})$/i;
      const matrixIds = [];
      const cabinIds = [];
      for (const token of raw) {
        const mDev = token.match(deviceRegex);
        const mCab = token.match(cabinRegex);
        if (mDev) {
          matrixIds.push(mDev[1]);
        } else if (mCab) {
          cabinIds.push(mCab[1]);
        } else if (idRegex.test(token)) {
          matrixIds.push(token);
        } else {
          return res.status(400).json({ success: false, message: "accessPointIds must be MatrixDevice ObjectIds, 'MATRIX_DEVICE:<id>' or 'CABIN:<id>'" });
        }
      }

      if (cabinIds.length) {
        const cabins = await Cabin.find({ _id: { $in: cabinIds } }).select('building matrixDevices').lean();
        const found = new Set(cabins.map(c => String(c._id)));
        const missing = cabinIds.filter(id => !found.has(String(id)));
        if (missing.length) {
          return res.status(400).json({ success: false, message: `Unknown cabins: ${missing.join(', ')}` });
        }
        const invalidCabins = cabins.filter(c => String(c.building) !== String(targetBuildingId));
        if (invalidCabins.length) {
          return res.status(400).json({ success: false, message: 'All cabins must belong to the same building as the policy' });
        }
        for (const c of cabins) {
          for (const did of (c.matrixDevices || [])) matrixIds.push(String(did));
        }
      }

      normalizedPoints = Array.from(new Set(matrixIds));
    }

    if (normalizedPoints) {
      const idRegex = /^[a-f\d]{24}$/i;
      const matrixIds = normalizedPoints
        .map((p) => {
          return idRegex.test(p) ? p : null;
        })
        .filter(Boolean);
      if (matrixIds.length > 0) {
        const devices = await MatrixDevice.find({ _id: { $in: matrixIds } }).select('_id buildingId status').lean();
        const foundIds = new Set(devices.map(d => String(d._id)));
        const missing = matrixIds.filter(id => !foundIds.has(String(id)));
        if (missing.length) {
          return res.status(400).json({ success: false, message: `Unknown Matrix devices: ${missing.join(', ')}` });
        }
        const invalid = devices.filter(d => String(d.buildingId) !== String(targetBuildingId));
        if (invalid.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must belong to the same building as the policy' });
        }
        const inactive = devices.filter(d => d.status !== 'active');
        if (inactive.length) {
          return res.status(400).json({ success: false, message: 'Matrix devices must be active to be added to a policy' });
        }
      }
      update.accessPointIds = normalizedPoints;
    }

    if (update.isDefaultForBuilding === true) {
      await AccessPolicy.updateMany(
        { buildingId: targetBuildingId, isDefaultForBuilding: true, _id: { $ne: id } },
        { $set: { isDefaultForBuilding: false } }
      );
    }

    const updated = await AccessPolicy.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    await logCRUDActivity(req, 'UPDATE', 'AccessPolicy', updated._id, null, update);
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('updateAccessPolicy error:', err);
    await logErrorActivity(req, err, 'Access:Policies:Update');
    return res.status(500).json({ success: false, message: 'Failed to update policy' });
  }
};

const isNowWithinDailyWindow = (fromStr, toStr, now = new Date()) => {
  if (!fromStr && !toStr) return true; // no restriction
  const from = parseTimeHHMM(fromStr);
  const to = parseTimeHHMM(toStr);
  if (!from || !to) return true; // malformed -> allow by default
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = from.h * 60 + from.m;
  const end = to.h * 60 + to.m;
  if (end >= start) {
    return minutes >= start && minutes <= end;
  }
  // window spans midnight
  return minutes >= start || minutes <= end;
};

const writeAudit = async ({ memberId, clientId, accessGrantId, action, actorType, actorId, reason, meta }) => {
  try {
    await AccessAudit.create({ memberId, clientId, accessGrantId, action, actorType, actorId, reason, meta });
  } catch (e) {
    console.warn("AccessAudit failed:", e?.message);
  }
};

export const grantAccess = async (req, res) => {
  try {
    const { memberId, policyId, startsAt, endsAt, source, notes } = req.body || {};
    // Support multiple casings/keys for bypass flag from client
    const rawBypass = (req.body?.bypassInvoicesPaid ?? req.body?.bypassInvoices ?? req.body?.bypassinvoicespaid ?? req.body?.bypassinvoices);
    const bypassInvoices = Boolean(rawBypass);
    if (!memberId || !policyId || !source) {
      return res.status(400).json({ success: false, message: "memberId, policyId, source are required" });
    }
    if (!mongoose.Types.ObjectId.isValid(memberId) || !mongoose.Types.ObjectId.isValid(policyId)) {
      return res.status(400).json({ success: false, message: "Invalid memberId or policyId" });
    }
    const policy = await AccessPolicy.findById(policyId).lean();
    if (!policy) return res.status(404).json({ success: false, message: "Policy not found" });

    // Resolve member and client to set grant.clientId and validate building alignment
    const member = await Member.findById(memberId).populate({ path: 'client', select: 'building' });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    const clientId = member.client?._id || member.client || null;
    if (!clientId) return res.status(400).json({ success: false, message: "Member has no associated client" });
    let clientBuildingId = null;
    try {
      const cli = member.client?._id ? member.client : await Client.findById(clientId).select('building').lean();
      clientBuildingId = cli?.building ? String(cli.building) : null;
    } catch {}
    if (policy.buildingId && clientBuildingId && String(policy.buildingId) !== String(clientBuildingId)) {
      return res.status(400).json({ success: false, message: "Policy building does not match member's client building" });
    }

    const start = startsAt ? new Date(startsAt) : new Date();
    const end = endsAt ? new Date(endsAt) : undefined;
    if (end && end <= start) {
      return res.status(400).json({ success: false, message: "endsAt must be after startsAt" });
    }

    // Create ACTIVE grant
    const created = await AccessGrant.create({
      memberId,
      clientId,
      policyId,
      status: "ACTIVE",
      source,
      startsAt: start,
      endsAt: end,
      notes,
      bypassInvoices,
    });

    await writeAudit({
      memberId,
      clientId: clientId,
      accessGrantId: created._id,
      action: "GRANT",
      actorType: "ADMIN",
      actorId: req.user?._id,
      meta: { policyId, bypassInvoices }
    });

    await logCRUDActivity(req, "CREATE", "AccessGrant", created._id, null, { memberId, policyId, clientId });
    // If bypass is set, do not enforce invoice status for this grant creation
    if (!bypassInvoices) {
      try {
        await enforceAccessByInvoices(clientId);
      } catch (e) {
        console.warn("enforceAccessByInvoices after grant failed:", e?.message);
      }
    } else {
      // Optional: record that enforcement was bypassed
      try {
        await writeAudit({ memberId, clientId, accessGrantId: created._id, action: "ENFORCEMENT_BYPASS", actorType: "ADMIN", actorId: req.user?._id, meta: { stage: "GRANT_CREATE" } });
      } catch {}
    }

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("grantAccess error:", err);
    await logErrorActivity(req, err, "Access:Grant");
    const code = err?.code === "DUPLICATE_ACTIVE_GRANT" ? 400 : 500;
    return res.status(code).json({ success: false, message: err?.message || "Failed to grant access" });
  }
};

export const revokeAccess = async (req, res) => {
  try {
    const { grantId, memberId, policyId, reason } = req.body || {};
    let grant = null;
    if (grantId) {
      grant = await AccessGrant.findById(grantId);
    } else if (memberId && policyId) {
      grant = await AccessGrant.findOne({ memberId, policyId, status: { $in: ["ACTIVE", "PENDING", "SUSPENDED"] } });
    }
    if (!grant) return res.status(404).json({ success: false, message: "Access grant not found" });

    grant.status = "REVOKED";
    grant.endsAt = new Date();
    grant.qrCodeToken = undefined;
    grant.qrCodeTokenHash = undefined;
    grant.qrCodeExpiresAt = undefined;
    await grant.save();

    await writeAudit({
      memberId: grant.memberId,
      clientId: grant.clientId,
      accessGrantId: grant._id,
      action: "REVOKE",
      actorType: "ADMIN",
      actorId: req.user?._id,
      reason,
    });

    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "REVOKED" });

    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("revokeAccess error:", err);
    await logErrorActivity(req, err, "Access:Revoke");
    return res.status(500).json({ success: false, message: "Failed to revoke access" });
  }
};

export const suspendGrant = async (req, res) => {
  try {
    const { grantId, reason } = req.body || {};
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Access grant not found" });

    if (grant.status !== "ACTIVE") {
      return res.status(400).json({ success: false, message: "Only ACTIVE grants can be suspended" });
    }

    grant.status = "SUSPENDED";
    await grant.save();

    await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "SUSPEND", actorType: "ADMIN", actorId: req.user?._id, reason });
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "SUSPENDED" });

    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("suspendGrant error:", err);
    await logErrorActivity(req, err, "Access:Suspend");
    return res.status(500).json({ success: false, message: "Failed to suspend access" });
  }
};

export const resumeGrant = async (req, res) => {
  try {
    const { grantId, reason } = req.body || {};
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Access grant not found" });

    // Allow resuming when SUSPENDED or REVOKED; block otherwise
    if (!["SUSPENDED", "REVOKED"].includes(grant.status)) {
      return res.status(400).json({ success: false, message: "Only SUSPENDED or REVOKED grants can be resumed" });
    }

    const wasRevoked = grant.status === "REVOKED";
    grant.status = "ACTIVE";

    // Optionally update bypass flag on resume if provided
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'bypassInvoices') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'bypassInvoicesPaid') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'bypassinvoicespaid') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'bypassinvoices')) {
      const rawBypass = (req.body?.bypassInvoicesPaid ?? req.body?.bypassInvoices ?? req.body?.bypassinvoicespaid ?? req.body?.bypassinvoices);
      grant.bypassInvoices = Boolean(rawBypass);
    }

    // For revoked grants, if endsAt is in the past (due to revoke setting endsAt = now), clear it
    const now = new Date();
    if (wasRevoked) {
      if (grant.endsAt && grant.endsAt <= now) {
        grant.endsAt = undefined;
      }
      // If admin provides a new endsAt, apply it (must be after startsAt)
      const newEndsAt = req.body?.endsAt ? new Date(req.body.endsAt) : null;
      if (newEndsAt) {
        const start = grant.startsAt ? new Date(grant.startsAt) : now;
        if (newEndsAt <= start) {
          return res.status(400).json({ success: false, message: "endsAt must be after startsAt" });
        }
        grant.endsAt = newEndsAt;
      }
    }

    await grant.save();

    // Auto-regenerate a QR token on resume so member regains QR access immediately.
    // Expiry: if grant.endsAt exists, use that; otherwise use a long TTL (365 days).
    let issuedQrToken = null;
    try {
      const token = crypto.randomBytes(24).toString("hex");
      const hash = sha256(token);
      grant.qrCodeTokenHash = hash;
      const nowMs = Date.now();
      const longTtlMs = 365 * 24 * 60 * 60 * 1000; // 365 days
      grant.qrCodeExpiresAt = grant.endsAt ? new Date(grant.endsAt) : new Date(nowMs + longTtlMs);
      grant.qrCodeToken = token; // optional plaintext for immediate delivery
      await grant.save();
      issuedQrToken = { token, expiresAt: grant.qrCodeExpiresAt };
    } catch (qrErr) {
      console.warn("Failed to auto-regenerate QR on resume:", qrErr?.message);
    }

    await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "RESUME", actorType: "ADMIN", actorId: req.user?._id, reason, meta: { bypassInvoices: Boolean(grant.bypassInvoices) } });
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "ACTIVE" });
    let enforcement = null;
    if (!grant.bypassInvoices) {
      try {
        enforcement = await enforceAccessByInvoices(grant.clientId);
      } catch (e) {
        console.warn("enforceAccessByInvoices after resume failed:", e?.message);
      }
    } else {
      try {
        await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "ENFORCEMENT_BYPASS", actorType: "ADMIN", actorId: req.user?._id, meta: { stage: "GRANT_RESUME" } });
      } catch {}
      enforcement = { action: 'bypassed' };
    }

    // Re-fetch the grant to return the actual persisted status after enforcement
    const latest = await AccessGrant.findById(grant._id).lean();
    return res.json({ success: true, data: latest || grant, enforcement });
  } catch (err) {
    console.error("resumeGrant error:", err);
    await logErrorActivity(req, err, "Access:Resume");
    return res.status(500).json({ success: false, message: "Failed to resume access" });
  }
};

export const extendGrant = async (req, res) => {
  try {
    const { grantId, endsAt } = req.body || {};
    if (!endsAt) return res.status(400).json({ success: false, message: "endsAt is required" });

    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Access grant not found" });

    const end = new Date(endsAt);
    if (grant.startsAt && end <= grant.startsAt) {
      return res.status(400).json({ success: false, message: "endsAt must be after startsAt" });
    }
    grant.endsAt = end;
    await grant.save();

    await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "EXTEND", actorType: "ADMIN", actorId: req.user?._id, meta: { endsAt: end } });
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { endsAt: end });

    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("extendGrant error:", err);
    await logErrorActivity(req, err, "Access:Extend");
    return res.status(500).json({ success: false, message: "Failed to extend access" });
  }
};

export const listAccessGrants = async (req, res) => {
  try {
    const { clientId, memberId, status, page = 1, limit = 20 } = req.query || {};
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (memberId) filter.memberId = memberId;
    if (status) filter.status = { $in: String(status).split(",").map((s) => s.toUpperCase()) };

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      AccessGrant.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate({ path: "policyId", select: "name accessPointIds allowedFromTime allowedToTime effectiveFrom effectiveTo" })
        .populate({ path: "memberId", select: "name firstName lastName email phone status" })
        .populate({ path: "clientId", select: "companyName name legalName displayName" })
        .lean(),
      AccessGrant.countDocuments(filter),
    ]);

    const pagination = {
      currentPage: Number(page) || 1,
      totalPages: Math.ceil(total / Number(limit || 1)),
      totalRecords: total,
      hasMore: skip + Number(limit) < total,
    };

    return res.json({ success: true, data: items, pagination });
  } catch (err) {
    console.error("listAccessGrants error:", err);
    await logErrorActivity(req, err, "Access:List");
    return res.status(500).json({ success: false, message: "Failed to list access grants" });
  }
};

export const generateQR = async (req, res) => {
  try {
    const { grantId, ttlMinutes = 30 } = req.body || {};
    if (!grantId) return res.status(400).json({ success: false, message: "grantId is required" });

    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Access grant not found" });

    // Authorization logic: allow admin with permission/role, or member self-service
    const roleName = req.userRole?.roleName?.toLowerCase?.() || req.user?.roleName?.toLowerCase?.();
    const perms = Array.isArray(req.userRole?.permissions) ? req.userRole.permissions : [];
    const isAdmin = Boolean(roleName === 'admin' || perms.includes('member:manage_access'));
    const isMemberSelf = Boolean(req.memberId && String(req.memberId) === String(grant.memberId));
    if (!isAdmin && !isMemberSelf) {
      return res.status(403).json({ success: false, message: "Not authorized to generate QR for this grant" });
    }

    if (grant.status !== "ACTIVE") {
      return res.status(400).json({ success: false, message: "Grant must be ACTIVE to generate QR" });
    }

    const now = new Date();
    if (grant.startsAt && now < grant.startsAt) {
      return res.status(400).json({ success: false, message: "Grant not yet active" });
    }
    if (grant.endsAt && now > grant.endsAt) {
      return res.status(400).json({ success: false, message: "Grant expired" });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const hash = sha256(token);
    grant.qrCodeTokenHash = hash;
    grant.qrCodeExpiresAt = new Date(now.getTime() + Number(ttlMinutes) * 60 * 1000);
    await grant.save();

    await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_GENERATED", actorType: isAdmin ? "ADMIN" : "SYSTEM", actorId: req.user?._id, meta: { ttlMinutes: Number(ttlMinutes) } });

    return res.json({ success: true, data: { token, grantId: grant._id, expiresAt: grant.qrCodeExpiresAt } });
  } catch (err) {
    console.error("generateQR error:", err);
    await logErrorActivity(req, err, "Access:QR:Generate");
    return res.status(500).json({ success: false, message: "Failed to generate QR" });
  }
};

export const validateQR = async (req, res) => {
  try {
    const { token, accessPointId } = req.body || {};
    if (!token) return res.status(400).json({ success: false, message: "token is required" });
    if (!accessPointId) return res.status(400).json({ success: false, message: "accessPointId is required" });

    const hash = sha256(token);
    const now = new Date();

    // Find by token hash regardless of expiry to classify reason
    const byHash = await AccessGrant.findOne({ qrCodeTokenHash: hash }).populate({ path: "policyId", select: "name accessPointIds allowedFromTime allowedToTime effectiveFrom effectiveTo clientId" });
    if (!byHash) {
      return res.status(200).json({ success: true, allowed: false, reason: "INVALID_QR" });
    }

    const grant = byHash;

    // Expiry check
    if (!grant.qrCodeExpiresAt || grant.qrCodeExpiresAt < now) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "EXPIRED_QR", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "EXPIRED_QR" });
    }

    // Status and date window checks
    if (grant.status !== "ACTIVE") {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: grant.status, meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: grant.status });
    }
    if (grant.startsAt && now < grant.startsAt) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "NOT_YET_ACTIVE", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "NOT_YET_ACTIVE" });
    }
    if (grant.endsAt && now > grant.endsAt) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "EXPIRED_GRANT", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "EXPIRED_GRANT" });
    }

    const policy = grant.policyId?.toObject ? grant.policyId.toObject() : grant.policyId;
    if (policy?.effectiveFrom && now < new Date(policy.effectiveFrom)) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "POLICY_NOT_EFFECTIVE", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "POLICY_NOT_EFFECTIVE" });
    }
    if (policy?.effectiveTo && now > new Date(policy.effectiveTo)) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "POLICY_EXPIRED", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "POLICY_EXPIRED" });
    }
    if (grant.qrBoundAccessPointId && String(grant.qrBoundAccessPointId) !== String(accessPointId)) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "ACCESS_POINT_DENIED", meta: { accessPointId, boundTo: grant.qrBoundAccessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "ACCESS_POINT_DENIED" });
    }

    // Access point check (policy-level) - compare as strings because schema stores ObjectIds
    if (Array.isArray(policy?.accessPointIds) && policy.accessPointIds.length > 0) {
      const allowedIds = policy.accessPointIds.map((id) => String(id));
      if (!allowedIds.includes(String(accessPointId))) {
        await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "ACCESS_POINT_DENIED", meta: { accessPointId } });
        return res.status(200).json({ success: true, allowed: false, reason: "ACCESS_POINT_DENIED" });
      }
    }

    // Daily window check
    if (!isNowWithinDailyWindow(policy?.allowedFromTime, policy?.allowedToTime, now)) {
      await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_DENIED", actorType: "SCANNER", reason: "OUTSIDE_ALLOWED_TIME", meta: { accessPointId } });
      return res.status(200).json({ success: true, allowed: false, reason: "OUTSIDE_ALLOWED_TIME" });
    }

    await writeAudit({ memberId: grant.memberId, clientId: grant.clientId, accessGrantId: grant._id, action: "QR_CONSUMED", actorType: "SCANNER", meta: { accessPointId } });
    return res.status(200).json({ success: true, allowed: true, memberId: grant.memberId, clientId: grant.clientId, policyId: grant.policyId?._id || grant.policyId });
  } catch (err) {
    console.error("validateQR error:", err);
    await logErrorActivity(req, err, "Access:QR:Validate");
    return res.status(500).json({ success: false, message: "Failed to validate QR" });
  }
};
