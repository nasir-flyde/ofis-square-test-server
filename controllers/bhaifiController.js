import BhaifiUser from "../models/bhaifiUserModel.js";
import Member from "../models/memberModel.js";
import Contract from "../models/contractModel.js";
import DayPass from "../models/dayPassModel.js";
import Building from "../models/buildingModel.js";
import BhaifiNas from "../models/bhaifiNasModel.js";
import { bhaifiCreateUser, bhaifiWhitelist, bhaifiDewhitelist } from "../services/bhaifiService.js";

const getEnvNasId = () => process.env.BHAIFI_DEFAULT_NAS_ID || "test_39_1";

export const normalizePhoneToUserName = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  // Remove leading zeros
  p = p.replace(/^0+/, "");
  // Ensure we have only one leading 91
  if (p.startsWith("91")) {
    p = p.replace(/^91+/, "");
  }
  if (p.length > 10) {
    // take last 10 digits as mobile
    p = p.slice(-10);
  }
  if (p.length !== 10) return null;
  return `91${p}`;
};

export const formatDateTime = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
};

export const endOfDayString = (d) => {
  const dd = new Date(d);
  dd.setHours(23, 59, 59, 0);
  return formatDateTime(dd);
};

export const normalizeToDateTimeString = (input) => {
  if (!input) return null;
  if (Object.prototype.toString.call(input) === '[object Date]') {
    return formatDateTime(input);
  }
  let s = String(input).trim();
  if (!s) return null;
  if (s.includes('T')) {
    s = s.replace('T', ' ');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s} 23:59:59`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) {
    return `${s}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return s;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return formatDateTime(d);
  }
  return s;
};


export const createBhaifiUser = async (req, res) => {
  try {
    const { memberId, contractId } = req.body || {};
    if (!memberId) return res.status(400).json({ success: false, message: "memberId is required" });

    const member = await Member.findById(memberId).populate("client");
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });

    const name = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.companyName || "Member";
    const email = member.email;
    const userName = normalizePhoneToUserName(member.phone);

    if (!email) {
      console.warn("[BHAIFI] Missing member email", { memberId: String(member._id), phone: member.phone, name });
      return res.status(400).json({ success: false, message: "Member email is required" });
    }
    if (!userName) {
      console.warn("[BHAIFI] Invalid member phone for username normalization", { memberId: String(member._id), rawPhone: member.phone });
      return res.status(400).json({ success: false, message: "Valid member phone is required (10 digits)" });
    }

    // Idempotency: check existing
    let existing = await BhaifiUser.findOne({ member: member._id, userName });
    if (existing) {
      return res.json({ success: true, message: "Bhaifi user already exists", data: existing });
    }

    const nasId = getEnvNasId();
    const idType = 1;

    console.log("[BHAIFI] Creating user for member", {
      memberId: String(member._id),
      payload: { email, idType, name, nasId, userName }
    });
    const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });
    console.log("[BHAIFI] Create user API success", { memberId: String(member._id), responseKeys: Object.keys(apiRes?.data || {}) });

    const doc = await BhaifiUser.create({
      member: member._id,
      client: member.client || null,
      contract: contractId || null,
      email,
      name,
      userName,
      idType,
      nasId,
      bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
      status: "active",
      lastSyncAt: new Date(),
      meta: { request: apiRes?.payload, response: apiRes?.data },
    });

    // Immediately whitelist if contractId provided and contract has endDate
    if (contractId) {
      try {
        const contract = await Contract.findById(contractId).select('endDate');
        if (contract?.endDate) {
          const startDate = formatDateTime(new Date());
          const endDate = endOfDayString(new Date(contract.endDate));
          console.log('[BHAIFI] Whitelisting after creation', { memberId: String(member._id), startDate, endDate, userName, nasId });
          await bhaifiWhitelist({ nasId, startDate, endDate, userName });
          // Persist whitelist record
          const startAt = new Date(startDate.replace(' ', 'T'));
          const endAt = new Date(endDate.replace(' ', 'T'));
          doc.lastWhitelistedAt = new Date();
          doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
          doc.lastSyncAt = new Date();
          doc.status = "active";
          doc.meta = { ...(doc.meta || {}), lastWhitelist: { startDate, endDate } };
          doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
          doc.whitelistHistory.push({
            startDateString: startDate,
            endDateString: endDate,
            startAt: isNaN(startAt.getTime()) ? undefined : startAt,
            endAt: isNaN(endAt.getTime()) ? undefined : endAt,
            requestedBy: (req.user && req.user._id) ? req.user._id : null,
            source: 'manual',
            response: undefined,
          });
          await doc.save();
        } else {
          console.warn('[BHAIFI] Skipping whitelist: contract has no endDate', { contractId });
        }
      } catch (wErr) {
        console.warn('[BHAIFI] Whitelist after creation failed', { message: wErr?.message, status: wErr?.response?.status, data: wErr?.response?.data });
      }
    }

    return res.json({ success: true, message: "Bhaifi user created", data: doc });
  } catch (err) {
    console.error("createBhaifiUser error", err?.message);
    return res.status(500).json({ success: false, message: "Failed to create Bhaifi user", error: err?.message });
  }
};

// Dewhitelist user via provider API and record the action locally
export const dewhitelistBhaifiUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const doc = await BhaifiUser.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const userName = doc.userName;
    const nasId = doc.nasId || getEnvNasId();
    if (!userName) return res.status(400).json({ success: false, message: 'Missing userName to dewhitelist' });

    // Call provider API to remove from whitelist
    const apiRes = await bhaifiDewhitelist({ nasId, userName });

    // Append history
    doc.dewhitelistHistory = Array.isArray(doc.dewhitelistHistory) ? doc.dewhitelistHistory : [];
    doc.dewhitelistHistory.push({
      reason: reason || 'Manual dewhitelist',
      requestedBy: (req.user && req.user._id) ? req.user._id : null,
      source: 'manual',
    });
    // Mark active-until as now (logical end)
    doc.whitelistActiveUntil = new Date();
    doc.lastSyncAt = new Date();
    doc.status = "dewhitelist";
    doc.meta = { ...(doc.meta || {}), lastDewhitelist: apiRes?.data };
    await doc.save();
    return res.json({ success: true, message: 'Dewhitelisted successfully', data: apiRes?.data });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to dewhitelist user', error: err?.message });
  }
};

export const listBhaifiUsers = async (req, res) => {
  try {
    const { memberId, clientId, q, status, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (memberId) filter.member = memberId;
    if (clientId) filter.client = clientId;
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { email: new RegExp(q, "i") },
        { name: new RegExp(q, "i") },
        { userName: new RegExp(q, "i") },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      BhaifiUser.find(filter)
        .populate("member", "firstName lastName email phone companyName")
        .populate("client", "companyName legalName")
        .populate("contract", "contractNumber status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      BhaifiUser.countDocuments(filter),
    ]);

    return res.json({ success: true, data: { items, total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to list Bhaifi users", error: err?.message });
  }
};

// Create (or get) NAS mapping for a building
export const createNasForBuilding = async (req, res) => {
  try {
    const { buildingId } = req.params;
    const { nasId, label, isActive = true } = req.body || {};
    if (!buildingId) return res.status(400).json({ success: false, message: 'buildingId is required' });
    if (!nasId || !String(nasId).trim()) return res.status(400).json({ success: false, message: 'nasId is required' });
    const b = await Building.findById(buildingId).select('_id');
    if (!b) return res.status(404).json({ success: false, message: 'Building not found' });

    // Idempotent upsert-like behavior: find existing by (building, nasId)
    let doc = await BhaifiNas.findOne({ building: buildingId, nasId: String(nasId).trim() });
    if (!doc) {
      doc = await BhaifiNas.create({ building: buildingId, nasId: String(nasId).trim(), label: label || undefined, isActive: Boolean(isActive) });
    } else if (label !== undefined || isActive !== undefined) {
      // Allow updating label/isActive on existing
      doc.label = (label !== undefined) ? label : doc.label;
      if (isActive !== undefined) doc.isActive = Boolean(isActive);
      await doc.save();
    }
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    // Handle unique constraint violation gracefully
    if (err && err.code === 11000) {
      try {
        const { buildingId } = req.params;
        const { nasId } = req.body || {};
        const existing = await BhaifiNas.findOne({ building: buildingId, nasId: String(nasId).trim() });
        if (existing) return res.status(200).json({ success: true, data: existing, message: 'Already exists' });
      } catch (_) { }
    }
    return res.status(500).json({ success: false, message: 'Failed to create NAS mapping', error: err?.message });
  }
};

export const getBhaifiUser = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await BhaifiUser.findById(id)
      .populate("member", "firstName lastName email phone companyName")
      .populate("client", "companyName legalName")
      .populate("contract", "contractNumber status");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch Bhaifi user", error: err?.message });
  }
};

// List Bhaifi NAS devices for a building
export const listNasByBuilding = async (req, res) => {
  try {
    const { buildingId } = req.params;
    if (!buildingId) {
      return res.status(400).json({ success: false, message: 'buildingId is required' });
    }
    const items = await BhaifiNas.find({ building: buildingId })
      .select('_id nasId label isActive createdAt updatedAt')
      .sort({ isActive: -1, createdAt: -1 })
      .lean();
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list NAS for building', error: err?.message });
  }
};

// Manually trigger Bhaifi whitelist for a given local BhaifiUser id
export const whitelistBhaifiUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate: startOverride, endDate: endOverride, dayPassId } = req.body || {};
    let doc = await BhaifiUser.findById(id).populate("contract", "endDate");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const userName = doc.userName;
    const nasId = doc.nasId || getEnvNasId();
    if (!userName) return res.status(400).json({ success: false, message: "Missing userName to whitelist" });

    const startDate = normalizeToDateTimeString(startOverride) || formatDateTime(new Date());
    let endDate = normalizeToDateTimeString(endOverride);
    if (!endDate) {
      if (doc.contract?.endDate) {
        endDate = endOfDayString(new Date(doc.contract.endDate));
      } else {
        return res.status(400).json({ success: false, message: "Missing endDate: provide in body or link a contract with endDate" });
      }
    }

    console.log('[BHAIFI] Manual whitelist', { bhaifiUserId: String(doc._id), userName, nasId, startDate, endDate });
    const apiRes = await bhaifiWhitelist({ nasId, startDate, endDate, userName });

    // update meta
    const startAt = new Date(String(startDate).replace(' ', 'T'));
    const endAt = new Date(String(endDate).replace(' ', 'T'));
    doc.lastSyncAt = new Date();
    doc.lastWhitelistedAt = new Date();
    doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
    doc.status = "active";
    doc.meta = { ...(doc.meta || {}), lastWhitelist: apiRes?.data };
    doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
    doc.whitelistHistory.push({
      startDateString: startDate,
      endDateString: endDate,
      startAt: isNaN(startAt.getTime()) ? undefined : startAt,
      endAt: isNaN(endAt.getTime()) ? undefined : endAt,
      requestedBy: (req.user && req.user._id) ? req.user._id : null,
      source: 'manual',
      response: apiRes?.data,
    });
    await doc.save();

    // If this action corresponds to a Day Pass, mark its wifiAccess=true
    if (dayPassId) {
      try {
        await DayPass.findByIdAndUpdate(dayPassId, { $set: { 'buildingAccess.wifiAccess': true } });
      } catch (e) {
        console.warn('[BHAIFI] Failed to mark wifiAccess on DayPass', { dayPassId, message: e?.message });
      }
    }

    return res.json({ success: true, message: "Whitelisted successfully", data: { startDate, endDate, response: apiRes?.data } });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to whitelist user", error: err?.message });
  }
};

// Orchestrator to auto-provision for a member (internal use)
export const ensureBhaifiForMember = async ({ memberId, contractId }) => {
  const member = await Member.findById(memberId).populate([
    { path: "client", populate: { path: "building" } }
  ]);
  if (!member) {
    console.warn("[BHAIFI] ensureBhaifiForMember: Member not found", { memberId: String(memberId) });
    throw new Error("Member not found");
  }
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.companyName || "Member";
  const email = member.email;
  const userName = normalizePhoneToUserName(member.phone);
  console.log("[BHAIFI] ensureBhaifiForMember inputs", {
    memberId: String(member._id),
    memberEmail: email,
    memberPhone: member.phone,
    normalizedUserName: userName,
  });
  if (!email || !userName) {
    console.warn("[BHAIFI] ensureBhaifiForMember: Missing email or phone", {
      memberId: String(member._id),
      emailPresent: !!email,
      phonePresent: !!member.phone,
    });
    throw new Error("Missing email or phone for member");
  }

  // Try to get building's NAS ID first, fallback to environment default
  let nasId = getEnvNasId();
  const building = member.client?.building;

  if (building?.wifiAccess?.enterpriseLevel?.enabled &&
    Array.isArray(building.wifiAccess.enterpriseLevel.nasRefs) &&
    building.wifiAccess.enterpriseLevel.nasRefs.length > 0) {

    const nasDocs = await BhaifiNas.find({
      _id: { $in: building.wifiAccess.enterpriseLevel.nasRefs },
      isActive: true
    }).select('nasId').lean();

    if (nasDocs.length > 0) {
      // Use the first active NAS ID from building mapping
      nasId = nasDocs[0].nasId;
      console.log(`[BHAIFI] Using building NAS mapping for member ${member._id}:`, {
        buildingId: building._id,
        nasId,
        totalActiveNas: nasDocs.length
      });
    }
  } else {
    console.log(`[BHAIFI] Using default NAS ID for member ${member._id} (no building mapping found)`, { nasId });
  }

  const idType = 1;
  let doc = await BhaifiUser.findOne({ member: member._id, userName });

  // If not found locally, try to create (or link if exists remotely)
  if (!doc) {
    let apiUserId = null;
    let apiResponseData = null;
    let apiRequestPayload = null;

    try {
      console.log("[BHAIFI] ensureBhaifiForMember creating user", {
        memberId: String(member._id),
        payload: { email, idType, name, nasId, userName }
      });
      const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });
      apiUserId = apiRes?.data?.id || apiRes?.data?.userId;
      apiResponseData = apiRes?.data;
      apiRequestPayload = apiRes?.payload;
      console.log("[BHAIFI] ensureBhaifiForMember create success", { memberId: String(member._id) });
    } catch (e) {
      // If error is "already exists", we proceed to create local record anyway
      const status = e?.response?.status;
      const data = e?.response?.data || {};
      const msg = (data?.message || e?.message || '').toLowerCase();
      const firstErrorCode = Array.isArray(data.errors) && data.errors[0]?.code;
      const isAlreadyExists = status === 409 || status === 400 || (status === 422 && (String(firstErrorCode) === '102' || msg.includes('already exists'))) || msg.includes('duplicate');

      if (isAlreadyExists) {
        console.warn("[BHAIFI] ensureBhaifiForMember: User already exists on Bhaifi, creating local record only.", { memberId: String(member._id), userName });
        // We might not get the ID back in an error, so we leave apiUserId null or undefined
      } else {
        console.error("[BHAIFI] ensureBhaifiForMember create failed", {
          memberId: String(member._id),
          payload: { email, idType, name, nasId, userName },
          error: msg,
          status,
        });
        throw e;
      }
    }

    doc = await BhaifiUser.create({
      member: member._id,
      client: member.client || null,
      contract: contractId || null,
      email,
      name,
      userName,
      idType,
      nasId,
      bhaifiUserId: apiUserId || null,
      status: "active",
      lastSyncAt: new Date(),
      meta: { request: apiRequestPayload, response: apiResponseData },
    });
  }

  // Always ensure whitelist if contractId provided (whether doc existed or was just created)
  if (contractId) {
    try {
      const contract = await Contract.findById(contractId).select('startDate endDate');
      if (contract?.endDate) {
        const startDate = contract.startDate ? formatDateTime(new Date(contract.startDate)) : formatDateTime(new Date());
        const endDate = endOfDayString(new Date(contract.endDate));
        console.log('[BHAIFI] Whitelisting after creation (auto-provision)', { memberId: String(member._id), startDate, endDate, userName, nasId });
        await bhaifiWhitelist({ nasId, startDate, endDate, userName });
        // Persist whitelist record on auto-provision path
        const startAt = new Date(startDate.replace(' ', 'T'));
        const endAt = new Date(endDate.replace(' ', 'T'));
        doc.lastWhitelistedAt = new Date();
        doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
        doc.lastSyncAt = new Date();
        doc.status = "active";
        doc.meta = { ...(doc.meta || {}), lastWhitelist: { startDate, endDate } };
        doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
        doc.whitelistHistory.push({
          startDateString: startDate,
          endDateString: endDate,
          startAt: isNaN(startAt.getTime()) ? undefined : startAt,
          endAt: isNaN(endAt.getTime()) ? undefined : endAt,
          requestedBy: null,
          source: 'auto_provision',
          response: undefined,
        });
        await doc.save();
      } else {
        console.warn('[BHAIFI] Skipping whitelist (auto-provision): contract has no endDate', { contractId });
      }
    } catch (wErr) {
      console.warn('[BHAIFI] Whitelist after creation failed (auto-provision)', { message: wErr?.message, status: wErr?.response?.status, data: wErr?.response?.data });
    }
  }

  return doc;
};

// Grant enterprise-level Bhaifi access across all NAS refs for a building
export const grantEnterpriseAccess = async (req, res) => {
  try {
    const { buildingId } = req.params;
    const { userName: rawUserName, phone, memberId, startDate: startOverride, endDate: endOverride } = req.body || {};
    let userName = (rawUserName && String(rawUserName).trim()) || null;
    if (!userName && phone) userName = normalizePhoneToUserName(phone);
    if (!userName && memberId) {
      const m = await Member.findById(memberId).select('phone');
      if (!m) return res.status(404).json({ success: false, message: 'Member not found for userName resolution' });
      userName = normalizePhoneToUserName(m.phone);
    }
    if (!userName) return res.status(400).json({ success: false, message: 'userName or phone or memberId is required' });
    const building = await Building.findById(buildingId).lean();
    if (!building) return res.status(404).json({ success: false, message: 'Building not found' });
    const enterprise = building?.wifiAccess?.enterpriseLevel || {};
    const nasRefIds = Array.isArray(enterprise?.nasRefs) ? enterprise.nasRefs : [];
    if (!nasRefIds.length) return res.status(400).json({ success: false, message: 'No enterprise NAS configured for building' });
    const nasDocs = await BhaifiNas.find({ _id: { $in: nasRefIds }, isActive: true }).select('nasId label').lean();
    const nasIds = nasDocs.map(d => d.nasId).filter(Boolean);
    if (!nasIds.length) return res.status(400).json({ success: false, message: 'No active NAS found for building enterprise configuration' });
    const startDate = normalizeToDateTimeString(startOverride) || formatDateTime(new Date());
    let endDate = normalizeToDateTimeString(endOverride);
    if (!endDate) {
      const d = Number(enterprise?.defaultValidityDays);
      if (Number.isFinite(d) && d > 0) {
        const end = new Date();
        end.setDate(end.getDate() + d);
        endDate = endOfDayString(end);
      } else {
        return res.status(400).json({ success: false, message: 'endDate is required (or set wifiAccess.enterpriseLevel.defaultValidityDays)' });
      }
    }

    const results = [];
    for (const nasId of nasIds) {
      try {
        const t0 = Date.now();
        const apiRes = await bhaifiWhitelist({ nasId, startDate, endDate, userName });
        results.push({ nasId, ok: true, status: 'success', message: 'whitelisted', latencyMs: Date.now() - t0, data: apiRes?.data });
      } catch (e) {
        results.push({
          nasId,
          ok: false,
          status: 'failed',
          message: e?.response?.data?.message || e?.message || 'Failed',
          code: e?.code,
          httpStatus: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    const summary = {
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    };

    return res.json({ success: true, data: { buildingId, userName, startDate, endDate, nasCount: nasIds.length, results, summary } });
  } catch (err) {
    console.error('[BHAIFI] grantEnterpriseAccess error', err?.message);
    return res.status(500).json({ success: false, message: 'Failed to grant enterprise access', error: err?.message });
  }
};
