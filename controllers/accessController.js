import mongoose from "mongoose";
import crypto from "crypto";
import AccessPolicy from "../models/accessPolicyModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import AccessGrant from "../models/accessGrantModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessAudit from "../models/accessAuditModel.js";
import Cabin from "../models/cabinModel.js";
import AccessPoint from "../models/accessPointModel.js";
import CommonArea from "../models/commonAreaModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";
import { enforceAccessByInvoices, extendGrant as serviceExtendGrant } from "../services/accessService.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const parseTimeHHMM = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
};

export const listAccessPolicies = async (req, res) => {
  try {
    const { buildingId, clientId, page = 1, limit = 200 } = req.query || {};
    const filter = {};
    let resolvedBuildingId = buildingId;
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
      commonAreaId,
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

    // Build and normalize access points list (back-compat accepts MatrixDevice IDs and Cabin tokens)
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
    } else if (commonAreaId) {
      const ca = await CommonArea.findById(commonAreaId).select('buildingId matrixDevices').lean();
      if (!ca) {
        return res.status(404).json({ success: false, message: 'Common Area not found' });
      }
      if (String(ca.buildingId) !== String(buildingId)) {
        return res.status(400).json({ success: false, message: 'Common Area must belong to the same building as the policy' });
      }
      points = (ca.matrixDevices || []).map((id) => String(id));
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
          // Treat plain 24-hex as either AccessPoint _id or MatrixDevice _id; prefer AccessPoint if exists
          const maybeAp = await AccessPoint.findById(token).select('_id').lean();
          if (maybeAp) {
            // We'll map this below by discovering its deviceBinding(s). For now, keep a placeholder
            // Push a special marker to later resolve as AP directly
            matrixIds.push(`AP_DIRECT:${token}`);
          } else {
            matrixIds.push(token);
          }
        } else {
          return res.status(400).json({ success: false, message: "accessPointIds must be AccessPoint ObjectIds, MatrixDevice ObjectIds, 'MATRIX_DEVICE:<id>' or 'CABIN:<id>'" });
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
      points = Array.from(new Set(matrixIds));
    }
    const apIds = [];
    for (const token of points) {
      if (String(token).startsWith('AP_DIRECT:')) {
        const apId = token.split(':')[1];
        apIds.push(apId);
        continue;
      }
      const devId = token;
      let ap = await AccessPoint.findOne({ buildingId, "deviceBindings.deviceId": devId }).select('_id').lean();
      if (!ap) {
        const nameSuffix = String(devId).slice(-6);
        const createdAp = await AccessPoint.create({
          buildingId,
          name: `AP ${nameSuffix}`,
          bindingType: 'custom',
          pointType: 'DOOR',
          deviceBindings: [{ vendor: 'MATRIX_COSEC', deviceId: devId, direction: 'BIDIRECTIONAL' }],
          status: 'active',
        });
        apIds.push(String(createdAp._id));
      } else {
        apIds.push(String(ap._id));
      }
    }

    const payload = {
      buildingId,
      name: name.trim(),
      ...(description ? { description } : {}),
      accessPointIds: Array.from(new Set(apIds)),
      ...(allowedFromTime ? { allowedFromTime } : {}),
      ...(allowedToTime ? { allowedToTime } : {}),
      ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom) } : {}),
      ...(effectiveTo ? { effectiveTo: new Date(effectiveTo) } : {}),
      isDefaultForBuilding: Boolean(isDefaultForBuilding),
    };
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
      commonAreaId,
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
    } else if (commonAreaId) {
      const ca = await CommonArea.findById(commonAreaId).select('buildingId matrixDevices').lean();
      if (!ca) {
        return res.status(404).json({ success: false, message: 'Common Area not found' });
      }
      if (String(ca.buildingId) !== String(targetBuildingId)) {
        return res.status(400).json({ success: false, message: 'Common Area must belong to the same building as the policy' });
      }
      normalizedPoints = (ca.matrixDevices || []).map((id) => String(id));
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
          const maybeAp = await AccessPoint.findById(token).select('_id').lean();
          if (maybeAp) {
            matrixIds.push(`AP_DIRECT:${token}`);
          } else {
            matrixIds.push(token);
          }
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
      // Map tokens to AP ids (create on demand for MatrixDevice ids)
      const apIds = [];
      for (const token of normalizedPoints) {
        if (!token) continue;
        if (!idRegex.test(token)) {
          // token may be AP_DIRECT:<apId>
          if (String(token).startsWith('AP_DIRECT:')) {
            apIds.push(token.split(':')[1]);
            continue;
          }
          continue;
        }
        const devId = token;
        let ap = await AccessPoint.findOne({ buildingId: targetBuildingId, "deviceBindings.deviceId": devId }).select('_id').lean();
        if (!ap) {
          const nameSuffix = String(devId).slice(-6);
          const createdAp = await AccessPoint.create({
            buildingId: targetBuildingId,
            name: `AP ${nameSuffix}`,
            bindingType: 'custom',
            pointType: 'DOOR',
            deviceBindings: [{ vendor: 'MATRIX_COSEC', deviceId: devId, direction: 'BIDIRECTIONAL' }],
            status: 'active',
          });
          apIds.push(String(createdAp._id));
        } else {
          apIds.push(String(ap._id));
        }
      }
      update.accessPointIds = Array.from(new Set(apIds));
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

// Access Grants: list, create (grant), revoke, suspend, resume, extend
export const listAccessGrants = async (req, res) => {
  try {
    const { page = 1, limit = 50, clientId, memberId, status } = req.query || {};
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (memberId) filter.memberId = memberId;
    if (status) filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AccessGrant.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AccessGrant.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: items,
      pagination: {
        currentPage: Number(page) || 1,
        totalPages: Math.ceil(total / Number(limit || 1)),
        totalRecords: total,
      },
    });
  } catch (err) {
    console.error("listAccessGrants error:", err);
    await logErrorActivity(req, err, "Access:Grants:List");
    return res.status(500).json({ success: false, message: "Failed to list access grants" });
  }
};

export const grantAccess = async (req, res) => {
  try {
    const {
      memberId,
      clientId,
      policyId,
      startsAt,
      endsAt,
      bypassInvoices = false,
      qrBoundAccessPointId,
      source = "MANUAL",
    } = req.body || {};

    if (!memberId || !clientId) {
      return res.status(400).json({ success: false, message: "memberId and clientId are required" });
    }

    const now = new Date();
    const longTtlMs = 365 * 24 * 60 * 60 * 1000; // 365 days
    const token = crypto.randomBytes(24).toString("hex");
    const hash = sha256(token);
    const expiry = endsAt ? new Date(endsAt) : new Date(now.getTime() + longTtlMs);

    const grant = await AccessGrant.create({
      memberId,
      clientId,
      policyId: policyId || undefined,
      status: "ACTIVE",
      source,
      startsAt: startsAt ? new Date(startsAt) : now,
      endsAt: endsAt ? new Date(endsAt) : undefined,
      ...(qrBoundAccessPointId ? { qrBoundAccessPointId } : {}),
      qrCodeToken: token,
      qrCodeTokenHash: hash,
      qrCodeExpiresAt: expiry,
      bypassInvoices: Boolean(bypassInvoices),
    });

    try {
      await AccessAudit.create({
        memberId,
        clientId,
        accessGrantId: grant._id,
        action: "GRANT",
        actorType: req?.user ? "USER" : "SYSTEM",
        actorId: req?.user?._id,
        meta: { policyId, source },
      });
    } catch (e) {
      console.warn("AccessAudit (GRANT) failed:", e?.message);
    }

    await logCRUDActivity(req, "CREATE", "AccessGrant", grant._id, null, {
      memberId,
      clientId,
      policyId: policyId || null,
    });

    // Return token only at creation time for QR generation client-side if needed
    return res.status(201).json({ success: true, data: { ...grant.toObject(), qrCodeToken: token } });
  } catch (err) {
    console.error("grantAccess error:", err);
    await logErrorActivity(req, err, "Access:Grants:Grant");
    return res.status(500).json({ success: false, message: "Failed to grant access" });
  }
};

export const revokeAccess = async (req, res) => {
  try {
    const { grantId, reason } = req.body || {};
    if (!grantId) return res.status(400).json({ success: false, message: "grantId is required" });
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Grant not found" });
    grant.status = "REVOKED";
    await grant.save();
    try {
      await AccessAudit.create({
        memberId: grant.memberId,
        clientId: grant.clientId,
        accessGrantId: grant._id,
        action: "REVOKE",
        actorType: req?.user ? "USER" : "SYSTEM",
        actorId: req?.user?._id,
        reason,
      });
    } catch (e) {
      console.warn("AccessAudit (REVOKE) failed:", e?.message);
    }
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "REVOKED" });
    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("revokeAccess error:", err);
    await logErrorActivity(req, err, "Access:Grants:Revoke");
    return res.status(500).json({ success: false, message: "Failed to revoke access" });
  }
};

export const suspendGrant = async (req, res) => {
  try {
    const { grantId, reason } = req.body || {};
    if (!grantId) return res.status(400).json({ success: false, message: "grantId is required" });
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Grant not found" });
    grant.status = "SUSPENDED";
    await grant.save();
    try {
      await AccessAudit.create({
        memberId: grant.memberId,
        clientId: grant.clientId,
        accessGrantId: grant._id,
        action: "SUSPEND",
        actorType: req?.user ? "USER" : "SYSTEM",
        actorId: req?.user?._id,
        reason,
      });
    } catch (e) {
      console.warn("AccessAudit (SUSPEND) failed:", e?.message);
    }
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "SUSPENDED" });
    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("suspendGrant error:", err);
    await logErrorActivity(req, err, "Access:Grants:Suspend");
    return res.status(500).json({ success: false, message: "Failed to suspend access" });
  }
};

export const resumeGrant = async (req, res) => {
  try {
    const { grantId, reason } = req.body || {};
    if (!grantId) return res.status(400).json({ success: false, message: "grantId is required" });
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Grant not found" });
    grant.status = "ACTIVE";
    await grant.save();
    try {
      await AccessAudit.create({
        memberId: grant.memberId,
        clientId: grant.clientId,
        accessGrantId: grant._id,
        action: "RESUME",
        actorType: req?.user ? "USER" : "SYSTEM",
        actorId: req?.user?._id,
        reason,
      });
    } catch (e) {
      console.warn("AccessAudit (RESUME) failed:", e?.message);
    }
    await logCRUDActivity(req, "UPDATE", "AccessGrant", grant._id, null, { status: "ACTIVE" });
    return res.json({ success: true, data: grant });
  } catch (err) {
    console.error("resumeGrant error:", err);
    await logErrorActivity(req, err, "Access:Grants:Resume");
    return res.status(500).json({ success: false, message: "Failed to resume access" });
  }
};

export const extendGrant = async (req, res) => {
  try {
    const { grantId, endsAt } = req.body || {};
    if (!grantId || !endsAt) {
      return res.status(400).json({ success: false, message: "grantId and endsAt are required" });
    }
    const updated = await serviceExtendGrant(grantId, endsAt);
    await logCRUDActivity(req, "UPDATE", "AccessGrant", updated._id, null, { endsAt: updated.endsAt });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("extendGrant error:", err);
    await logErrorActivity(req, err, "Access:Grants:Extend");
    return res.status(500).json({ success: false, message: err?.message || "Failed to extend grant" });
  }
};

export const generateQR = async (req, res) => {
  try {
    const { grantId, expiresInDays = 365 } = req.body || {};
    if (!grantId) return res.status(400).json({ success: false, message: "grantId is required" });
    const grant = await AccessGrant.findById(grantId);
    if (!grant) return res.status(404).json({ success: false, message: "Grant not found" });

    const token = crypto.randomBytes(24).toString("hex");
    const hash = sha256(token);
    const now = new Date();
    const ttlMs = Number(expiresInDays) * 24 * 60 * 60 * 1000;
    grant.qrCodeToken = token;
    grant.qrCodeTokenHash = hash;
    grant.qrCodeExpiresAt = new Date(now.getTime() + ttlMs);
    await grant.save();

    try {
      await AccessAudit.create({
        memberId: grant.memberId,
        clientId: grant.clientId,
        accessGrantId: grant._id,
        action: "QR_REGENERATE",
        actorType: req?.user ? "USER" : "SYSTEM",
        actorId: req?.user?._id,
        meta: { expiresInDays: Number(expiresInDays) },
      });
    } catch (e) {
      console.warn("AccessAudit (QR_REGENERATE) failed:", e?.message);
    }

    return res.json({ success: true, data: { grantId: String(grant._id), token, expiresAt: grant.qrCodeExpiresAt } });
  } catch (err) {
    console.error("generateQR error:", err);
    await logErrorActivity(req, err, "Access:QR:Generate");
    return res.status(500).json({ success: false, message: "Failed to generate QR" });
  }
};

export const validateQR = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ success: false, message: "token is required" });
    }
    const hash = sha256(token);
    const now = new Date();
    const grant = await AccessGrant.findOne({ qrCodeTokenHash: hash }).lean();
    if (!grant) return res.status(404).json({ success: false, message: "Invalid token" });
    if (grant.qrCodeExpiresAt && new Date(grant.qrCodeExpiresAt) < now) {
      return res.status(400).json({ success: false, message: "Token expired" });
    }
    if (grant.status === "REVOKED" || grant.status === "SUSPENDED") {
      return res.status(403).json({ success: false, message: `Grant ${grant.status}` });
    }
    return res.json({ success: true, data: { grantId: String(grant._id), memberId: String(grant.memberId), clientId: String(grant.clientId) } });
  } catch (err) {
    console.error("validateQR error:", err);
    await logErrorActivity(req, err, "Access:QR:Validate");
    return res.status(500).json({ success: false, message: "Failed to validate QR" });
  }
};
