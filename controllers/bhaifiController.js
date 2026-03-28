import BhaifiUser from "../models/bhaifiUserModel.js";
import Member from "../models/memberModel.js";
import Contract from "../models/contractModel.js";
import DayPass from "../models/dayPassModel.js";
import Building from "../models/buildingModel.js";
import BhaifiNas from "../models/bhaifiNasModel.js";
import Guest from "../models/guestModel.js";
import { bhaifiCreateUser, bhaifiWhitelist, bhaifiDewhitelist, bhaifiUpdatePassword } from "../services/bhaifiService.js";

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
    const { userType, memberId, guestId, password, startDate, endDate, contractId } = req.body || {};

    let userBase = null;
    let name = "";
    let email = "";
    let phone = "";
    let building = null;
    let clientRef = null;
    let memberRef = null;
    let guestRef = null;

    if (userType === 'ondemand' || guestId) {
      if (!guestId) return res.status(400).json({ success: false, message: "guestId is required for ondemand user" });
      userBase = await Guest.findById(guestId).populate('buildingId');
      if (!userBase) return res.status(404).json({ success: false, message: "Guest not found" });

      name = userBase.name || "Guest";
      email = userBase.email;
      phone = userBase.phone;
      building = userBase.buildingId;
      guestRef = userBase._id;
    } else {
      if (!memberId) return res.status(400).json({ success: false, message: "memberId is required" });
      userBase = await Member.findById(memberId).populate([
        { path: "client", populate: { path: "building" } }
      ]);
      if (!userBase) return res.status(404).json({ success: false, message: "Member not found" });

      name = [userBase.firstName, userBase.lastName].filter(Boolean).join(" ") || userBase.companyName || "Member";
      email = userBase.email;
      phone = userBase.phone;
      building = userBase.client?.building || null;
      clientRef = userBase.client?._id || null;
      memberRef = userBase._id;
    }

    const userName = normalizePhoneToUserName(phone);

    if (!email) {
      console.warn("[BHAIFI] Missing user email", { userId: String(userBase._id), phone, name });
      return res.status(400).json({ success: false, message: "Email is required" });
    }
    if (!userName) {
      console.warn("[BHAIFI] Invalid phone for username normalization", { userId: String(userBase._id), rawPhone: phone });
      return res.status(400).json({ success: false, message: "Valid phone is required (10 digits)" });
    }

    let existingQuery = { userName };
    if (memberRef) existingQuery.member = memberRef;
    if (guestRef) existingQuery.guest = guestRef;

    let doc = await BhaifiUser.findOne(existingQuery);

    let nasId = getEnvNasId();
    if (building?.wifiAccess?.enterpriseLevel?.enabled &&
        Array.isArray(building.wifiAccess.enterpriseLevel.nasRefs) &&
        building.wifiAccess.enterpriseLevel.nasRefs.length > 0) {
      const nasDocs = await BhaifiNas.find({
        _id: { $in: building.wifiAccess.enterpriseLevel.nasRefs },
        isActive: true
      }).select('nasId').lean();

      if (nasDocs.length > 0) {
        nasId = nasDocs[0].nasId;
      }
    }

    const idType = 1;

    if (!doc) {
      let apiUserId = null;
      let apiResponseData = null;
      let apiRequestPayload = null;

      try {
        const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });
        apiUserId = apiRes?.data?.id || apiRes?.data?.userId || null;
        apiResponseData = apiRes?.data;
        apiRequestPayload = apiRes?.payload;
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data || {};
        const msg = (data?.message || e?.message || '').toLowerCase();
        const firstErrorCode = Array.isArray(data.errors) && data.errors[0]?.code;
        const isAlreadyExists = status === 409 || status === 400 || (status === 422 && (String(firstErrorCode) === '102' || msg.includes('already exists'))) || msg.includes('duplicate') || String(data?.code) === '102' || msg.includes('user already exists');

        if (isAlreadyExists) {
          apiRequestPayload = { email, idType, name, nasId, userName };
        } else {
          console.error("[BHAIFI] createBhaifiUser failed", { userId: String(userBase._id), error: msg, status });
          throw e;
        }
      }

      doc = await BhaifiUser.create({
        member: memberRef || null,
        guest: guestRef || null,
        client: clientRef || null,
        contract: contractId || null,
        email,
        name,
        userName,
        idType,
        nasId,
        bhaifiUserId: apiUserId,
        status: "active",
        lastSyncAt: new Date(),
        meta: { request: apiRequestPayload, response: apiResponseData },
      });
    }

    // Set or auto-set password
    if (password) {
      await autoSetBhaifiPassword({ bhaifiDoc: doc, buildingId: building?._id || building, explicitPassword: password });
    }

    // Determine Whitelist dates
    let finalStartDate = startDate;
    let finalEndDate = endDate;

    if (!finalStartDate || !finalEndDate) {
      if (contractId) {
        const contract = await Contract.findById(contractId).select('endDate');
        if (contract?.endDate) {
          if (!finalStartDate) finalStartDate = formatDateTime(new Date());
          if (!finalEndDate) finalEndDate = endOfDayString(new Date(contract.endDate));
        }
      }
    }

    if (finalStartDate && finalEndDate) {
      try {
        await bhaifiWhitelist({ nasId, startDate: finalStartDate, endDate: finalEndDate, userName });
        const startAt = new Date(finalStartDate.replace(' ', 'T'));
        const endAt = new Date(finalEndDate.replace(' ', 'T'));
        doc.lastWhitelistedAt = new Date();
        doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
        doc.lastSyncAt = new Date();
        doc.status = "active";
        doc.meta = { ...(doc.meta || {}), lastWhitelist: { startDate: finalStartDate, endDate: finalEndDate } };
        doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
        doc.whitelistHistory.push({
          startDateString: finalStartDate,
          endDateString: finalEndDate,
          startAt: isNaN(startAt.getTime()) ? undefined : startAt,
          endAt: isNaN(endAt.getTime()) ? undefined : endAt,
          requestedBy: (req.user && req.user._id) ? req.user._id : null,
          source: 'manual',
          response: undefined,
        });
        await doc.save();
      } catch (wErr) {
        console.warn('[BHAIFI] Whitelist after creation failed', { message: wErr?.message });
      }
    }

    return res.json({ success: true, message: "Bhaifi user configured", data: doc });
  } catch (err) {
    console.error("createBhaifiUser error", err?.message);
    return res.status(500).json({ success: false, message: "Failed to configure Bhaifi user", error: err?.message });
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

    // Always use current time (avoids 422 errors for past dates)
    const startDate = formatDateTime(new Date());
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

  // Provision remotely if not found remotely (missing bhaifiUserId) or if local record doesn't exist
  if (!doc || !doc.bhaifiUserId) {
    let apiUserId = null;
    let apiResponseData = null;
    let apiRequestPayload = null;

    try {
      console.log("[BHAIFI] ensureBhaifiForMember ensuring user exists remotely", {
        memberId: String(member._id),
        payload: { email, idType, name, nasId, userName }
      });
      const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });
      apiUserId = apiRes?.data?.id || apiRes?.data?.userId;
      apiResponseData = apiRes?.data;
      apiRequestPayload = apiRes?.payload;
      console.log("[BHAIFI] ensureBhaifiForMember remote creation success", { memberId: String(member._id), apiUserId });
    } catch (e) {
      // If error is "already exists", we proceed to create/link local record
      const status = e?.response?.status;
      const data = e?.response?.data || {};
      const msg = (data?.message || e?.message || '').toLowerCase();
      const firstErrorCode = Array.isArray(data.errors) && data.errors[0]?.code;
      const isAlreadyExists = status === 409 || status === 400 || (status === 422 && (String(firstErrorCode) === '102' || msg.includes('already exists'))) || msg.includes('duplicate') || String(data?.code) === '102' || msg.includes('user already exists');

      if (isAlreadyExists) {
        console.warn("[BHAIFI] ensureBhaifiForMember: User already exists on Bhaifi, keeping local record.", { memberId: String(member._id), userName });
        // Try to capture ID from response if available on conflict
        apiUserId = data?.id || data?.userId || (data?.data && (data.data.id || data.data.userId)) || null;
        apiResponseData = data;
      } else {
        console.error("[BHAIFI] ensureBhaifiForMember remote creation failed", {
          memberId: String(member._id),
          payload: { email, idType, name, nasId, userName },
          error: msg,
          status,
        });
        // If we have doc, but API failed with other error, we don't necessarily throw if it was already local
        if (!doc) throw e;
      }
    }

    if (!doc) {
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
    } else {
      // Update existing local record with remote ID if we got it
      doc.bhaifiUserId = apiUserId || doc.bhaifiUserId;
      doc.lastSyncAt = new Date();
      if (apiResponseData) {
        doc.meta = { ...(doc.meta || {}), lastEnsuredResponse: apiResponseData };
      }
      await doc.save();
    }
  }

  // Always ensure whitelist if contractId provided (whether doc existed or was just created)
  if (contractId) {
    try {
      const contract = await Contract.findById(contractId).select('startDate endDate');
      if (contract?.endDate) {
        const startDate = formatDateTime(new Date());
        const endDate = endOfDayString(new Date(contract.endDate));
        console.log('[BHAIFI] Whitelisting after creation (auto-provision)', { memberId: String(member._id), startDate, endDate, userName, nasId });
        await bhaifiWhitelist({ nasId, startDate, endDate, userName });
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
    const startDate = formatDateTime(new Date());
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

export const updateBhaifiUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, nasId: bodyNasId } = req.body || {};
    if (!password) return res.status(400).json({ success: false, message: 'password is required' });

    const doc = await BhaifiUser.findById(id).populate({
      path: 'client',
      populate: { path: 'building' }
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    const userName = doc.userName;
    if (!userName) return res.status(400).json({ success: false, message: 'Missing userName to update password' });

    let nasIdsToUpdate = [];
    if (bodyNasId) {
      nasIdsToUpdate.push(bodyNasId);
    } else {
      const building = doc.client?.building;
      if (building?.wifiAccess?.enterpriseLevel?.enabled &&
        Array.isArray(building.wifiAccess.enterpriseLevel.nasRefs) &&
        building.wifiAccess.enterpriseLevel.nasRefs.length > 0) {
        const nasDocs = await BhaifiNas.find({
          _id: { $in: building.wifiAccess.enterpriseLevel.nasRefs },
          isActive: true
        }).select('nasId').lean();
        nasIdsToUpdate = nasDocs.map(d => d.nasId).filter(Boolean);
      }

      // Fallback to exactly one default if none found
      if (nasIdsToUpdate.length === 0) {
        nasIdsToUpdate.push(doc.nasId || getEnvNasId());
      }
    }

    const results = [];
    for (const nasId of nasIdsToUpdate) {
      try {
        const t0 = Date.now();
        const apiRes = await bhaifiUpdatePassword({ userName, nasId, password });
        results.push({ nasId, ok: true, status: 'success', latencyMs: Date.now() - t0, data: apiRes?.data });
      } catch (e) {
        results.push({
          nasId,
          ok: false,
          status: 'failed',
          message: e?.response?.data?.message || e?.message || 'Failed',
          httpStatus: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    if (results.some(r => r.ok)) {
      doc.password = password;
      await doc.save();
    }

    const summary = {
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    };

    const allFailed = results.length > 0 && results.every(r => !r.ok);
    if (allFailed) {
      return res.status(results[0].httpStatus || 400).json({ success: false, message: 'Password update failed', data: { userName, results, summary } });
    }

    return res.json({ success: true, message: 'Password update processed', data: { userName, results, summary } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update password', error: err?.message });
  }
};

export const updateDayPassBhaifiPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ success: false, message: 'password is required' });

    const dayPass = await DayPass.findById(id).populate([
      { path: 'building' },
      { path: 'member', select: 'phone' }
    ]);
    if (!dayPass) return res.status(404).json({ success: false, message: 'DayPass not found' });

    let rawPhone = dayPass.visitorPhone || dayPass.visitorDetailsDraft?.phone || dayPass.member?.phone;
    if (!rawPhone) {
      return res.status(400).json({ success: false, message: 'No phone number available on this DayPass to update Wifi password' });
    }
    const userName = normalizePhoneToUserName(rawPhone);
    if (!userName) return res.status(400).json({ success: false, message: 'Invalid phone number format for username' });

    let nasIdsToUpdate = [];
    const building = dayPass.building;
    if (building?.wifiAccess?.daypass?.enabled &&
      Array.isArray(building.wifiAccess.daypass.nasRefs) &&
      building.wifiAccess.daypass.nasRefs.length > 0) {
      const nasDocs = await BhaifiNas.find({
        _id: { $in: building.wifiAccess.daypass.nasRefs },
        isActive: true
      }).select('nasId').lean();
      nasIdsToUpdate = nasDocs.map(d => d.nasId).filter(Boolean);
    }

    if (nasIdsToUpdate.length === 0) {
      nasIdsToUpdate.push(getEnvNasId());
    }

    const results = [];
    for (const nasId of nasIdsToUpdate) {
      try {
        const t0 = Date.now();
        const apiRes = await bhaifiUpdatePassword({ userName, nasId, password });
        results.push({ nasId, ok: true, status: 'success', latencyMs: Date.now() - t0, data: apiRes?.data });
      } catch (e) {
        results.push({
          nasId,
          ok: false,
          status: 'failed',
          message: e?.response?.data?.message || e?.message || 'Failed',
          httpStatus: e?.response?.status,
          data: e?.response?.data,
        });
      }
    }

    dayPass.buildingAccess = dayPass.buildingAccess || {};
    dayPass.buildingAccess.wifiAccess = true;
    await dayPass.save();

    if (results.some(r => r.ok)) {
      const bhaifiUser = await BhaifiUser.findOne({ userName });
      if (bhaifiUser) {
        bhaifiUser.password = password;
        await bhaifiUser.save();
      }
    }

    const summary = {
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    };

    const allFailed = results.length > 0 && results.every(r => !r.ok);
    if (allFailed) {
      return res.status(results[0].httpStatus || 400).json({ success: false, message: 'DayPass password update failed', data: { userName, results, summary } });
    }

    return res.json({ success: true, message: 'DayPass password update processed', data: { userName, results, summary } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update DayPass password', error: err?.message });
  }
};

// Helper utility to generate and update password automatically for a member across all building NAS IPs
export const autoSetBhaifiPassword = async ({ bhaifiDoc, buildingId, explicitPassword }) => {
  if (!bhaifiDoc || !bhaifiDoc.userName) return null;
  
  const password = explicitPassword || `Ofis@${Math.floor(100000 + Math.random() * 900000)}`;
  const userName = bhaifiDoc.userName;
  let nasIdsToUpdate = [];

  try {
    if (buildingId) {
      const building = await Building.findById(buildingId).lean();
      if (building?.wifiAccess?.enterpriseLevel?.enabled &&
          Array.isArray(building.wifiAccess.enterpriseLevel.nasRefs) &&
          building.wifiAccess.enterpriseLevel.nasRefs.length > 0) {
        const nasDocs = await BhaifiNas.find({
          _id: { $in: building.wifiAccess.enterpriseLevel.nasRefs },
          isActive: true
        }).select('nasId').lean();
        nasIdsToUpdate = nasDocs.map(d => d.nasId).filter(Boolean);
      }
    }

    if (nasIdsToUpdate.length === 0) {
      nasIdsToUpdate.push(bhaifiDoc.nasId || getEnvNasId());
    }

    let success = false;
    for (const nasId of nasIdsToUpdate) {
      try {
        const res = await bhaifiUpdatePassword({ userName, nasId, password });
        if (res?.ok) success = true;
      } catch (e) {
        console.warn(`[BHAIFI] autoSetBhaifiPassword failed for NAS ${nasId}:`, e?.message);
      }
    }

    if (success) {
      bhaifiDoc.password = password;
      await bhaifiDoc.save();
      console.log(`[BHAIFI] autoSetBhaifiPassword success for ${userName}`);
      return password;
    }
  } catch (err) {
    console.error("[BHAIFI] autoSetBhaifiPassword error:", err?.message);
  }
  return null;
};
