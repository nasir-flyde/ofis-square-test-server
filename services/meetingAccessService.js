import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import BhaifiUser from "../models/bhaifiUserModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import { bhaifiCreateUser, bhaifiWhitelist, bhaifiDewhitelist } from "../services/bhaifiService.js";
import matrixApi from "../utils/matrixApi.js";
import Visitor from "../models/visitorModel.js";

// ---- Helpers (copied patterns from Bhaifi/DayPass flows) ----
const getEnvNasId = () => process.env.BHAIFI_DEFAULT_NAS_ID || "test_39_1";

const normalizePhoneToUserName = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  p = p.replace(/^0+/, "");
  if (p.startsWith("91")) {
    p = p.replace(/^91+/, "");
  }
  if (p.length > 10) p = p.slice(-10);
  if (p.length !== 10) return null;
  return `91${p}`;
};

const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export async function provisionAccessForMeetingBooking({ bookingId }) {
  // Load booking with relations
  const booking = await MeetingBooking.findById(bookingId)
    .populate({ path: 'room', select: 'building name matrixDevices', populate: { path: 'building', select: 'name' } })
    .populate({ path: 'member', select: 'firstName lastName email phone client' })
    .populate({ path: 'guest', select: 'name email phone' })
    .populate({ path: 'visitors', select: 'name email phone' })
    .lean();
  if (!booking) return { ok: false, error: 'Booking not found' };

  const room = booking.room;
  if (!room) return { ok: false, error: 'Room not found on booking' };

  const start = new Date(booking.start);
  const end = new Date(booking.end);
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    return { ok: false, error: 'Invalid booking times' };
  }

  const visitors = Array.isArray(booking.visitors) ? booking.visitors : [];
  if (!visitors.length) {
    console.log('[MeetingAccess] Skip provisioning (no visitors)', { bookingId: String(booking._id) });
    return { ok: true, skipped: true, reason: 'no_visitors' };
  }

  const startDateString = fmt(start);
  const endDateString = fmt(end);

  // Iterate each visitor and provision access
  for (const v of visitors) {
    const vName = v?.name || 'Visitor';
    const vEmail = v?.email || undefined;
    const vPhone = v?.phone || undefined;
    const vUserName = normalizePhoneToUserName(vPhone); // required for Bhaifi
    const externalUserId = vUserName || `visitor:${String(v?._id || '')}`;

    // Bhaifi: create + whitelist only when both email and valid phone exist
    try {
      if (vEmail && vUserName) {
        const nasId = getEnvNasId();
        let bhaifi = await BhaifiUser.findOne({ userName: vUserName });
        if (!bhaifi) {
          const apiRes = await bhaifiCreateUser({ email: vEmail, idType: 1, name: vName, nasId, userName: vUserName });
          bhaifi = await BhaifiUser.create({
            email: vEmail,
            name: vName,
            userName: vUserName,
            idType: 1,
            nasId,
            bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
            status: 'active',
            lastSyncAt: new Date(),
            meta: { request: apiRes?.payload, response: apiRes?.data },
          });
        }
        await bhaifiWhitelist({ nasId: bhaifi.nasId || nasId, startDate: startDateString, endDate: endDateString, userName: vUserName });
        try {
          await MeetingBooking.findByIdAndUpdate(booking._id, { $set: { 'buildingAccess.wifiAccess': true } });
          await Visitor.findByIdAndUpdate(v._id, { $set: { 'buildingAccess.wifiAccess': true } });
        } catch { }
      }
    } catch (e) {
      console.warn('[MeetingAccess][Bhaifi][Visitor] Failed', { bookingId: String(booking._id), visitorId: String(v?._id || ''), message: e?.message });
    }

    // Matrix: ensure user + set validity + assign devices
    try {
      // Upsert local MatrixUser for visitor
      let mu = await MatrixUser.findOne({ externalUserId });
      if (!mu) {
        mu = await MatrixUser.create({
          buildingId: room.building?._id || room.building,
          name: vName,
          phone: vPhone,
          email: vEmail,
          externalUserId,
          status: 'active',
          validTill: end,
        });
      } else {
        await MatrixUser.findByIdAndUpdate(mu._id, { $set: { validTill: end } });
      }

      // Create/upsert on Matrix COSEC and set access-validity-date
      try {
        await matrixApi.createUser({ id: externalUserId, name: vName, email: vEmail, phone: vPhone, status: 'active', accessValidityDate: end });
      } catch (e) {
        console.warn('[MeetingAccess][Matrix][Visitor] createUser failed', { message: e?.message });
      }

      // Assign devices from MeetingRoom.matrixDevices
      const matrixDeviceObjIds = Array.isArray(room.matrixDevices) ? room.matrixDevices.map((d) => String(d)) : [];
      if (matrixDeviceObjIds.length) {
        const devices = await MatrixDevice.find({ _id: { $in: matrixDeviceObjIds } }).select('device_id').lean();
        let assigned = 0;
        for (const d of devices) {
          const device_id = d?.device_id;
          if (!device_id) continue;
          try {
            const resp = await matrixApi.assignUserToDevice({ device_id, externalUserId });
            if (resp?.ok) assigned += 1;
          } catch (assignErr) {
            console.warn('[MeetingAccess][Matrix][Visitor] assignUserToDevice failed', { device_id, message: assignErr?.message });
          }
        }
        if (assigned > 0) {
          try {
            await MatrixUser.findByIdAndUpdate(mu._id, { $set: { isDeviceAssigned: true, isEnrolled: true } });
            await MeetingBooking.findByIdAndUpdate(booking._id, { $set: { 'buildingAccess.matrixAccess': true } });
            await Visitor.findByIdAndUpdate(v._id, { $set: { 'buildingAccess.matrixAccess': true } });
          } catch { }
        }
      }
    } catch (e) {
      console.warn('[MeetingAccess][Matrix][Visitor] Failed', { bookingId: String(booking._id), visitorId: String(v?._id || ''), message: e?.message });
    }
  }

  return { ok: true };
}

// Revoke access (Matrix devices and mark WiFi flag false) for a meeting booking
export async function revokeAccessForMeetingBooking({ bookingId }) {
  // Load booking with relations to reconstruct externalUserId and devices
  const booking = await MeetingBooking.findById(bookingId)
    .populate({ path: 'room', select: 'building name matrixDevices', populate: { path: 'building', select: 'name' } })
    .populate({ path: 'member', select: 'firstName lastName email phone client' })
    .populate({ path: 'guest', select: 'name email phone' })
    .populate({ path: 'visitors', select: 'name email phone' })
    .lean();
  if (!booking) return { ok: false, error: 'Booking not found' };

  const room = booking.room;
  if (!room) return { ok: false, error: 'Room not found on booking' };

  const visitors = Array.isArray(booking.visitors) ? booking.visitors : [];

  // Revoke Matrix access from all devices linked to the room for each visitor
  try {
    const matrixDeviceObjIds = Array.isArray(room.matrixDevices) ? room.matrixDevices.map((d) => String(d)) : [];
    if (matrixDeviceObjIds.length && visitors.length) {
      const devices = await MatrixDevice.find({ _id: { $in: matrixDeviceObjIds } }).select('device_id').lean();
      for (const v of visitors) {
        const vUserName = normalizePhoneToUserName(v?.phone || '');
        const externalUserId = vUserName || `visitor:${String(v?._id || '')}`;
        for (const d of devices) {
          const device_id = d?.device_id;
          if (!device_id) continue;
          try {
            await matrixApi.revokeUserFromDevice({ device_id, externalUserId });
          } catch (revErr) {
            console.warn('[MeetingAccess][Matrix][Visitor] revokeUserFromDevice failed', { device_id, message: revErr?.message });
          }
        }
      }
    }
  } catch (e) {
    console.warn('[MeetingAccess][Matrix] revoke failed', { bookingId: String(booking._id), message: e?.message });
  }

  // Mark booking buildingAccess flags to false (best-effort)
  try { await MeetingBooking.findByIdAndUpdate(bookingId, { $set: { 'buildingAccess.wifiAccess': false, 'buildingAccess.matrixAccess': false } }); } catch (_) { }

  // Bhaifi dewhitelist for each visitor (best-effort)
  try {
    const nasId = getEnvNasId();
    for (const v of visitors) {
      const vUserName = normalizePhoneToUserName(v?.phone || '');
      if (!vUserName) continue;
      try {
        await bhaifiDewhitelist({ nasId, userName: vUserName });
      } catch (e) {
        console.warn('[MeetingAccess][Bhaifi][Visitor] dewhitelist failed', { userName: vUserName, message: e?.message });
      }
    }
  } catch (e) {
    console.warn('[MeetingAccess][Bhaifi] bulk dewhitelist failed', { bookingId: String(booking._id), message: e?.message });
  }

  // Cancel and invalidate all associated visitors (QR expiry) - best-effort
  try {
    const visitorIds = Array.isArray(booking.visitors) ? booking.visitors.map(v => (v?._id || v)) : [];
    if (visitorIds.length) {
      await Visitor.updateMany(
        { _id: { $in: visitorIds } },
        { $set: { status: 'cancelled', qrExpiresAt: new Date(), cancelledAt: new Date() } }
      );
    }
  } catch (e) {
    console.warn('[MeetingAccess][Visitors] Failed to cancel/invalidate visitors', { bookingId: String(booking._id), message: e?.message });
  }

  return { ok: true };
}

export default {
  provisionAccessForMeetingBooking,
  revokeAccessForMeetingBooking,
};
