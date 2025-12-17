import Member from "../models/memberModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessPoint from "../models/accessPointModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import RFIDCard from "../models/rfidCardModel.js";
import EnrollmentDetail from "../models/enrollmentDetailModel.js";
import BhaifiUser from "../models/bhaifiUserModel.js";
import Contract from "../models/contractModel.js";
import matrixApi from "../utils/matrixApi.js";
import { bhaifiCreateUser, bhaifiWhitelist, bhaifiDewhitelist } from "../services/bhaifiService.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// ---------------------- Helpers ----------------------
const pickMemberIdentity = (m, overrides = {}) => {
  const name = overrides.name || [m.firstName, m.lastName].filter(Boolean).join(" ") || m.companyName || "Member";
  const email = overrides.email || m.email || null;
  const phone = overrides.phone || m.phone || null;
  return { name, email, phone };
};

const normalizePhoneToUserName = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  p = p.replace(/^0+/, "");
  if (p.startsWith("91")) p = p.replace(/^91+/, "");
  if (p.length > 10) p = p.slice(-10);
  if (p.length !== 10) return null;
  return `91${p}`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const formatDateTime = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const endOfDayString = (d) => { const dd = new Date(d); dd.setHours(23,59,59,0); return formatDateTime(dd); };
const normalizeToDateTimeString = (input) => {
  if (!input) return null;
  if (Object.prototype.toString.call(input) === '[object Date]') return formatDateTime(input);
  let s = String(input).trim();
  if (!s) return null;
  if (s.includes('T')) s = s.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 23:59:59`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return formatDateTime(d);
  return s;
};

// ---------------------- MATRIX: create/link ----------------------
export const createMatrixUserForMember = async (req, res) => {
  try {
    const { id } = req.params; // Member id
    const { externalUserId, createOnMatrix = false, policyId, buildingId, clientId } = req.body || {};
    if (!externalUserId) return res.status(400).json({ success: false, message: 'externalUserId is required' });

    const member = await Member.findById(id);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    // If already linked and matches, return existing
    if (member.matrixUser) {
      const existing = await MatrixUser.findById(member.matrixUser);
      if (existing && existing.externalUserId === String(externalUserId)) {
        return res.json({ success: true, data: existing, message: 'Matrix already linked' });
      }
    }

    const { name, email, phone } = pickMemberIdentity(member, req.body || {});

    const payload = {
      buildingId: buildingId || undefined,
      clientId: clientId || member.client || undefined,
      memberId: member._id,
      name: name?.trim(),
      phone,
      email,
      externalUserId: String(externalUserId).trim(),
      status: 'active',
      ...(policyId ? { policyId } : {}),
    };

    let user = await MatrixUser.findOne({ memberId: member._id, externalUserId: payload.externalUserId });
    if (!user) user = await MatrixUser.create(payload);

    if (createOnMatrix) {
      try {
        await matrixApi.createUser({ id: externalUserId, name, email, phone, status: 'active' });
      } catch (e) {
        await logErrorActivity(req, e, 'MemberIntegrations:MatrixCreateOnMatrix', { externalUserId });
      }
    }

    // If policy provided, assign to devices derived from access points
    if (policyId) {
      try {
        const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
        if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length) {
          const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
          const deviceObjIds = [];
          for (const ap of accessPoints) {
            const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
            for (const b of bindings) if (b?.vendor === 'MATRIX_COSEC' && b?.deviceId) deviceObjIds.push(String(b.deviceId));
          }
          const uniqueIds = Array.from(new Set(deviceObjIds));
          if (uniqueIds.length) {
            const devices = await MatrixDevice.find({ _id: { $in: uniqueIds } }).select('device_id').lean();
            for (const d of devices) {
              const device_id = d?.device_id; if (!device_id) continue;
              try { await matrixApi.assignUserToDevice({ device_id, externalUserId }); } catch (e) { await logErrorActivity(req, e, 'MemberIntegrations:MatrixAssignDevice', { externalUserId, device_id }); }
            }
            try { await MatrixUser.findByIdAndUpdate(user._id, { $set: { isDeviceAssigned: true, isEnrolled: true } }); } catch {}
          }
        }
      } catch (e) {
        await logErrorActivity(req, e, 'MemberIntegrations:MatrixPolicyAssign', { policyId, externalUserId });
      }
    }

    // Link on member and denormalize identifier
    try {
      await Member.findByIdAndUpdate(member._id, { $set: { matrixUser: user._id, matrixExternalUserId: user.externalUserId } });
    } catch {}

    await logCRUDActivity(req, 'LINK', 'Member.MatrixUser', member._id, null, { matrixUserId: user._id, externalUserId: user.externalUserId });
    const fresh = await MatrixUser.findById(user._id).lean();
    return res.status(201).json({ success: true, data: fresh || user });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixCreate');
    return res.status(500).json({ success: false, message: 'Failed to create/link Matrix user' });
  }
};

export const assignMatrixDeviceForMember = async (req, res) => {
  try {
    const { id } = req.params; // Member
    const { deviceId, device_id } = req.body || {};
    const member = await Member.findById(id).select('matrixUser');
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
    if (!member.matrixUser) return res.status(400).json({ success: false, message: 'Member not linked to Matrix user' });
    const user = await MatrixUser.findById(member.matrixUser).select('externalUserId');
    if (!user || !user.externalUserId) return res.status(400).json({ success: false, message: 'Matrix externalUserId missing' });

    let resolvedDeviceId = device_id;
    if (!resolvedDeviceId && deviceId) {
      const dev = await MatrixDevice.findById(deviceId).select('device_id').lean();
      resolvedDeviceId = dev?.device_id;
    }
    if (!resolvedDeviceId) return res.status(400).json({ success: false, message: 'deviceId (or device_id) is required' });

    const resp = await matrixApi.assignUserToDevice({ device_id: resolvedDeviceId, externalUserId: user.externalUserId });
    const ok = !!resp?.ok;
    if (ok) {
      try { await MatrixUser.findByIdAndUpdate(member.matrixUser, { $set: { isDeviceAssigned: true, isEnrolled: true } }); } catch {}
      await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { assignToDevice: { device_id: resolvedDeviceId } });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixAssignDevice');
    return res.status(500).json({ success: false, message: 'Failed to assign Matrix device' });
  }
};

export const enrollCardToMatrixDevicesForMember = async (req, res) => {
  try {
    const { id } = req.params; // Member id
    const { policyId, enrollmentDetailId } = req.body || {};
    if (!policyId) return res.status(400).json({ success: false, message: 'policyId is required' });
    if (!enrollmentDetailId) return res.status(400).json({ success: false, message: 'enrollmentDetailId is required' });

    const member = await Member.findById(id).select('matrixUser');
    if (!member || !member.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });

    const detail = await EnrollmentDetail.findById(enrollmentDetailId).lean();
    if (!detail) return res.status(404).json({ success: false, message: 'EnrollmentDetail not found' });
    const enrollType = detail?.enroll?.enrollType || 'card';
    const enrollCount = Number(detail?.enroll?.enrollCount || 1);

    const user = await MatrixUser.findById(member.matrixUser).select('externalUserId').lean();
    if (!user?.externalUserId) return res.status(400).json({ success: false, message: 'Matrix externalUserId missing' });

    const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
    if (!policy || !Array.isArray(policy.accessPointIds) || !policy.accessPointIds.length) return res.status(404).json({ success: false, message: 'Policy not found or has no access points' });

    const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
    const matrixDeviceObjIds = [];
    for (const ap of accessPoints) {
      const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
      for (const b of bindings) if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) matrixDeviceObjIds.push(String(b.deviceId));
    }
    const uniqueDeviceObjIds = Array.from(new Set(matrixDeviceObjIds));
    if (!uniqueDeviceObjIds.length) return res.status(404).json({ success: false, message: 'No Matrix devices bound to the policy access points' });

    const devices = await MatrixDevice.find({ _id: { $in: uniqueDeviceObjIds } }).select('_id name device device_id deviceType').lean();
    const results = [];
    let successCount = 0;

    for (const d of devices) {
      const deviceParam = (typeof d?.device === 'number' && Number.isFinite(d.device)) ? d.device : null;
      if (deviceParam === null) { results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, ok: false, error: 'Missing numeric `device` on MatrixDevice' }); continue; }
      const deviceTypeNum = Number(d?.deviceType);
      const allowedDeviceTypes = [1, 16, 17];
      if (!allowedDeviceTypes.includes(deviceTypeNum)) { results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, ok: false, error: `Unsupported deviceType ${d?.deviceType}` }); continue; }
      try {
        const resp = await matrixApi.enrollCardToDevice({ externalUserId: user.externalUserId, device: deviceParam, deviceType: deviceTypeNum, enrollType, enrollCount });
        const ok = !!resp?.ok; if (ok) successCount += 1;
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, usedDeviceParam: deviceParam, ok, status: resp?.status || 0, data: resp?.data || null, deviceType: deviceTypeNum, enrollType, enrollCount });
      } catch (e) {
        results.push({ device: d?.device ?? null, device_id: d?.device_id ?? null, usedDeviceParam: deviceParam, ok: false, error: e?.message });
      }
    }

    if (successCount > 0) { try { await MatrixUser.findByIdAndUpdate(member.matrixUser, { $set: { isEnrolled: true } }); } catch {} }

    await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { enrollCardToDevice: { policyId, enrollmentDetailId, successCount, attempts: devices.length } });
    return res.json({ success: true, successCount, attempts: devices.length, results });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixEnrollCard');
    return res.status(500).json({ success: false, message: 'Failed to enroll card to device' });
  }
};

export const setMatrixCardCredentialForMember = async (req, res) => {
  try {
    const { id } = req.params; // Member id
    const { rfidCardId, cardId, deviceId: bodyDeviceId, device_id: bodyDevice_id, policyId: bodyPolicyId } = req.body || {};
    const refId = rfidCardId || cardId;
    if (!refId) return res.status(400).json({ success: false, message: 'rfidCardId (or cardId) is required' });

    const member = await Member.findById(id).select('matrixUser');
    if (!member || !member.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });

    const user = await MatrixUser.findById(member.matrixUser).select('externalUserId policyId').lean();
    if (!user?.externalUserId) return res.status(400).json({ success: false, message: 'Matrix externalUserId missing' });

    const card = await RFIDCard.findById(refId).select('cardUid').lean();
    if (!card?.cardUid) return res.status(404).json({ success: false, message: 'RFID card not found or missing cardUid' });

    const resp = await matrixApi.setCardCredential({ externalUserId: user.externalUserId, data: card.cardUid });
    const ok = !!resp?.ok;

    if (ok) {
      const resolvedDeviceMongoIds = [];
      try {
        if (bodyDeviceId) {
          const devById = await MatrixDevice.findById(bodyDeviceId).select('_id').lean();
          if (devById?._id) resolvedDeviceMongoIds.push(devById._id);
        } else if (bodyDevice_id) {
          const devByCode = await MatrixDevice.findOne({ device_id: bodyDevice_id }).select('_id').lean();
          if (devByCode?._id) resolvedDeviceMongoIds.push(devByCode._id);
        } else {
          const policyId = bodyPolicyId || user?.policyId;
          if (policyId) {
            const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
            if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length) {
              const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
              const deviceIdStrings = [];
              for (const ap of accessPoints) {
                const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
                for (const b of bindings) if (b?.vendor === 'MATRIX_COSEC' && b?.deviceId) deviceIdStrings.push(String(b.deviceId));
              }
              const unique = Array.from(new Set(deviceIdStrings));
              resolvedDeviceMongoIds.push(...unique);
            }
          }
        }
      } catch {}

      try {
        await MatrixUser.findByIdAndUpdate(member.matrixUser, { $set: { isCardCredentialVerified: true }, $addToSet: { cards: refId } });
        if (resolvedDeviceMongoIds.length) {
          await RFIDCard.findByIdAndUpdate(refId, { $addToSet: { devices: { $each: resolvedDeviceMongoIds } } });
        }
      } catch {}

      await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { setCardCredential: { rfidCardId: String(refId), devicesCount: resolvedDeviceMongoIds.length } });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixSetCardCredential');
    return res.status(500).json({ success: false, message: 'Failed to set card credential' });
  }
};

export const setMatrixCardVerifiedForMember = async (req, res) => {
  try {
    const { id } = req.params; const { verified = true } = req.body || {};
    const member = await Member.findById(id).select('matrixUser');
    if (!member?.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });
    const updated = await MatrixUser.findByIdAndUpdate(member.matrixUser, { isCardCredentialVerified: Boolean(verified) }, { new: true });
    await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { isCardCredentialVerified: Boolean(verified) });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixSetCardVerified');
    return res.status(500).json({ success: false, message: 'Failed to update card verification' });
  }
};

export const setMatrixValidityForMember = async (req, res) => {
  try {
    const { id } = req.params; const { validTill } = req.body || {};
    if (!validTill) return res.status(400).json({ success: false, message: 'validTill is required' });
    const member = await Member.findById(id).select('matrixUser');
    if (!member?.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });
    const updated = await MatrixUser.findByIdAndUpdate(member.matrixUser, { validTill: new Date(validTill) }, { new: true });
    await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { validTill: updated?.validTill });
    return res.json({ success: true, data: updated });
  } catch (err) {
    await logErrorActivity(req, err, 'MemberIntegrations:MatrixSetValidity');
    return res.status(500).json({ success: false, message: 'Failed to set validity' });
  }
};

export const listMatrixPolicyDevicesForMember = async (req, res) => {
  try {
    const { id } = req.params; const { policyId } = req.query || {};
    if (!policyId) return res.status(400).json({ success: false, message: 'policyId is required' });
    const member = await Member.findById(id).select('_id'); if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
    const policy = await AccessPolicy.findById(policyId).select('accessPointIds').lean();
    if (!policy || !Array.isArray(policy.accessPointIds) || !policy.accessPointIds.length) return res.status(404).json({ success: false, message: 'Policy not found or has no access points' });
    const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
    const matrixDeviceObjIds = [];
    for (const ap of accessPoints) { const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : []; for (const b of bindings) if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) matrixDeviceObjIds.push(String(b.deviceId)); }
    const uniqueIds = Array.from(new Set(matrixDeviceObjIds)); if (!uniqueIds.length) return res.json({ success: true, data: [] });
    const devices = await MatrixDevice.find({ _id: { $in: uniqueIds } }).select('_id name device_id').lean();
    return res.json({ success: true, data: devices });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:MatrixListPolicyDevices'); return res.status(500).json({ success: false, message: 'Failed to list policy devices' }); }
};

export const revokeMatrixFromDeviceForMember = async (req, res) => {
  try {
    const { id } = req.params; const { deviceId, device_id, rfidCardId } = req.body || {};
    const member = await Member.findById(id).select('matrixUser'); if (!member?.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });
    const user = await MatrixUser.findById(member.matrixUser).select('externalUserId').lean();
    if (!user?.externalUserId) return res.status(400).json({ success: false, message: 'Matrix externalUserId missing' });

    let resolvedDeviceId = device_id; let resolvedDeviceMongoId = null;
    if (!resolvedDeviceId && deviceId) { const dev = await MatrixDevice.findById(deviceId).select('_id device_id').lean(); resolvedDeviceId = dev?.device_id; resolvedDeviceMongoId = dev?._id || null; }
    if (!resolvedDeviceId) return res.status(400).json({ success: false, message: 'deviceId (or device_id) is required' });

    const resp = await matrixApi.revokeUserFromDevice({ device_id: resolvedDeviceId, externalUserId: user.externalUserId });
    const ok = !!resp?.ok;
    if (ok) {
      try {
        if (!resolvedDeviceMongoId && resolvedDeviceId) {
          const d = await MatrixDevice.findOne({ device_id: resolvedDeviceId }).select('_id').lean();
          resolvedDeviceMongoId = d?._id || null;
        }
        if (rfidCardId && resolvedDeviceMongoId) { await RFIDCard.findByIdAndUpdate(rfidCardId, { $pull: { devices: resolvedDeviceMongoId } }); }
      } catch {}
      await logCRUDActivity(req, 'UPDATE', 'Member.MatrixUser', id, null, { revokeFromDevice: { device_id: resolvedDeviceId, rfidCardId: rfidCardId || null } });
    }
    return res.status(ok ? 200 : 502).json({ success: ok, data: resp?.data || null, status: resp?.status || 0 });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:MatrixRevokeDevice'); return res.status(500).json({ success: false, message: 'Failed to revoke from device' }); }
};

export const listMatrixCardDevicesForMember = async (req, res) => {
  try {
    const { id } = req.params; const member = await Member.findById(id).select('matrixUser'); if (!member?.matrixUser) return res.status(404).json({ success: false, message: 'Member Matrix link not found' });
    const user = await MatrixUser.findById(member.matrixUser).select('cards').lean(); if (!user) return res.status(404).json({ success: false, message: 'Matrix user not found' });
    const cardIds = Array.isArray(user.cards) ? user.cards : []; if (!cardIds.length) return res.json({ success: true, data: [] });
    const cards = await RFIDCard.find({ _id: { $in: cardIds } }).select('_id cardUid devices').lean();
    const allDeviceObjIds = new Set(); for (const c of cards) { const devs = Array.isArray(c.devices) ? c.devices : []; for (const d of devs) allDeviceObjIds.add(String(d)); }
    const deviceIdList = Array.from(allDeviceObjIds); if (!deviceIdList.length) return res.json({ success: true, data: [] });
    const devices = await MatrixDevice.find({ _id: { $in: deviceIdList } }).select('_id name device_id').lean();
    const deviceMap = new Map(devices.map(d => [String(d._id), d])); const rows = [];
    for (const c of cards) { const devs = Array.isArray(c.devices) ? c.devices : []; for (const did of devs) { const d = deviceMap.get(String(did)); if (d) rows.push({ _id: d._id, name: d.name, device_id: d.device_id, rfidCardId: c._id, cardUid: c.cardUid }); } }
    return res.json({ success: true, data: rows });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:MatrixListCardDevices'); return res.status(500).json({ success: false, message: 'Failed to list card devices' }); }
};

// ---------------------- BHAIFI: create/link and whitelist ----------------------
export const createBhaifiForMember = async (req, res) => {
  try {
    const { id } = req.params; const { contractId } = req.body || {};
    const member = await Member.findById(id).populate('client'); if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    const name = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.companyName || "Member";
    const email = member.email; const userName = normalizePhoneToUserName(member.phone);
    if (!email) return res.status(400).json({ success: false, message: 'Member email is required' });
    if (!userName) return res.status(400).json({ success: false, message: 'Valid member phone is required (10 digits)' });

    let existing = await BhaifiUser.findOne({ member: member._id, userName });
    if (existing) {
      // Link on member if missing
      try { await Member.findByIdAndUpdate(member._id, { $set: { bhaifiUser: existing._id, bhaifiUserName: existing.userName } }); } catch {}
      return res.json({ success: true, message: 'Bhaifi user already exists', data: existing });
    }

    const nasId = process.env.BHAIFI_DEFAULT_NAS_ID || 'test_39_1';
    const idType = 1;
    const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });

    const doc = await BhaifiUser.create({
      member: member._id,
      client: member.client || null,
      contract: contractId || null,
      email, name, userName, idType, nasId,
      bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
      status: 'active', lastSyncAt: new Date(), meta: { request: apiRes?.payload, response: apiRes?.data },
    });

    // Optional auto-whitelist by contract endDate
    if (contractId) {
      try {
        const contract = await Contract.findById(contractId).select('endDate');
        if (contract?.endDate) {
          const startDate = formatDateTime(new Date());
          const endDate = endOfDayString(new Date(contract.endDate));
          await bhaifiWhitelist({ nasId, startDate, endDate, userName });
          const startAt = new Date(startDate.replace(' ', 'T'));
          const endAt = new Date(endDate.replace(' ', 'T'));
          doc.lastWhitelistedAt = new Date();
          doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
          doc.lastSyncAt = new Date();
          doc.status = 'active';
          doc.meta = { ...(doc.meta || {}), lastWhitelist: { startDate, endDate } };
          doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
          doc.whitelistHistory.push({ startDateString: startDate, endDateString: endDate, startAt: isNaN(startAt.getTime()) ? undefined : startAt, endAt: isNaN(endAt.getTime()) ? undefined : endAt, requestedBy: (req.user && req.user._id) ? req.user._id : null, source: 'manual', response: undefined });
          await doc.save();
        }
      } catch (e) { await logErrorActivity(req, e, 'MemberIntegrations:BhaifiAutoWhitelist', { contractId }); }
    }

    try { await Member.findByIdAndUpdate(member._id, { $set: { bhaifiUser: doc._id, bhaifiUserName: doc.userName } }); } catch {}
    await logCRUDActivity(req, 'LINK', 'Member.BhaifiUser', member._id, null, { bhaifiUserId: doc._id, userName: doc.userName });

    return res.json({ success: true, message: 'Bhaifi user created', data: doc });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:BhaifiCreate'); return res.status(500).json({ success: false, message: 'Failed to create Bhaifi user' }); }
};

export const whitelistBhaifiForMember = async (req, res) => {
  try {
    const { id } = req.params; const { startDate: startOverride, endDate: endOverride } = req.body || {};
    let doc = await BhaifiUser.findOne({ member: id }).populate('contract', 'endDate');
    if (!doc) return res.status(404).json({ success: false, message: 'Bhaifi user not found for member' });

    const userName = doc.userName; const nasId = doc.nasId || (process.env.BHAIFI_DEFAULT_NAS_ID || 'test_39_1');
    if (!userName) return res.status(400).json({ success: false, message: 'Missing userName to whitelist' });

    const startDate = normalizeToDateTimeString(startOverride) || formatDateTime(new Date());
    let endDate = normalizeToDateTimeString(endOverride);
    if (!endDate) {
      if (doc.contract?.endDate) endDate = endOfDayString(new Date(doc.contract.endDate));
      else return res.status(400).json({ success: false, message: 'Missing endDate: provide in body or link a contract with endDate' });
    }

    const apiRes = await bhaifiWhitelist({ nasId, startDate, endDate, userName });

    const startAt = new Date(String(startDate).replace(' ', 'T'));
    const endAt = new Date(String(endDate).replace(' ', 'T'));
    doc.lastSyncAt = new Date(); doc.lastWhitelistedAt = new Date();
    doc.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
    doc.status = 'active'; doc.meta = { ...(doc.meta || {}), lastWhitelist: apiRes?.data };
    doc.whitelistHistory = Array.isArray(doc.whitelistHistory) ? doc.whitelistHistory : [];
    doc.whitelistHistory.push({ startDateString: startDate, endDateString: endDate, startAt: isNaN(startAt.getTime()) ? undefined : startAt, endAt: isNaN(endAt.getTime()) ? undefined : endAt, requestedBy: (req.user && req.user._id) ? req.user._id : null, source: 'manual', response: apiRes?.data });
    await doc.save();

    return res.json({ success: true, message: 'Whitelisted successfully', data: { startDate, endDate, response: apiRes?.data } });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:BhaifiWhitelist'); return res.status(500).json({ success: false, message: 'Failed to whitelist user' }); }
};

export const dewhitelistBhaifiForMember = async (req, res) => {
  try {
    const { id } = req.params; const { reason } = req.body || {};
    const doc = await BhaifiUser.findOne({ member: id }); if (!doc) return res.status(404).json({ success: false, message: 'Bhaifi user not found for member' });
    const userName = doc.userName; const nasId = doc.nasId || (process.env.BHAIFI_DEFAULT_NAS_ID || 'test_39_1');
    if (!userName) return res.status(400).json({ success: false, message: 'Missing userName to dewhitelist' });

    const apiRes = await bhaifiDewhitelist({ nasId, userName });

    doc.dewhitelistHistory = Array.isArray(doc.dewhitelistHistory) ? doc.dewhitelistHistory : [];
    doc.dewhitelistHistory.push({ reason: reason || 'Manual dewhitelist', requestedBy: (req.user && req.user._id) ? req.user._id : null, source: 'manual' });
    doc.whitelistActiveUntil = new Date(); doc.lastSyncAt = new Date(); doc.status = 'dewhitelisted';
    doc.meta = { ...(doc.meta || {}), lastDewhitelist: apiRes?.data };
    await doc.save();

    return res.json({ success: true, message: 'Dewhitelisted successfully', data: apiRes?.data });
  } catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:BhaifiDewhitelist'); return res.status(500).json({ success: false, message: 'Failed to dewhitelist user' }); }
};

export const listBhaifiForMember = async (req, res) => {
  try { const { id } = req.params; const items = await BhaifiUser.find({ member: id }).sort({ createdAt: -1 }); return res.json({ success: true, data: items }); }
  catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:BhaifiList'); return res.status(500).json({ success: false, message: 'Failed to list Bhaifi users' }); }
};

export const getBhaifiForMember = async (req, res) => {
  try { const { id, bhaifiId } = req.params; const doc = await BhaifiUser.findOne({ _id: bhaifiId, member: id }); if (!doc) return res.status(404).json({ success: false, message: 'Not found' }); return res.json({ success: true, data: doc }); }
  catch (err) { await logErrorActivity(req, err, 'MemberIntegrations:BhaifiGet'); return res.status(500).json({ success: false, message: 'Failed to fetch Bhaifi user' }); }
};

export default {
  createMatrixUserForMember,
  assignMatrixDeviceForMember,
  enrollCardToMatrixDevicesForMember,
  setMatrixCardCredentialForMember,
  setMatrixCardVerifiedForMember,
  setMatrixValidityForMember,
  listMatrixPolicyDevicesForMember,
  revokeMatrixFromDeviceForMember,
  listMatrixCardDevicesForMember,
  createBhaifiForMember,
  whitelistBhaifiForMember,
  dewhitelistBhaifiForMember,
  listBhaifiForMember,
  getBhaifiForMember,
};
