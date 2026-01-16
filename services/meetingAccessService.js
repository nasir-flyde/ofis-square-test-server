import MeetingBooking from "../models/meetingBookingModel.js";
import MeetingRoom from "../models/meetingRoomModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import BhaifiUser from "../models/bhaifiUserModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import { bhaifiCreateUser, bhaifiWhitelist } from "../services/bhaifiService.js";
import matrixApi from "../utils/matrixApi.js";

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
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export async function provisionAccessForMeetingBooking({ bookingId }) {
  // Load booking with relations
  const booking = await MeetingBooking.findById(bookingId)
    .populate({ path: 'room', select: 'building name matrixDevices', populate: { path: 'building', select: 'name' } })
    .populate({ path: 'member', select: 'firstName lastName email phone client' })
    .populate({ path: 'guest', select: 'name email phone' })
    .lean();
  if (!booking) return { ok: false, error: 'Booking not found' };

  const room = booking.room;
  if (!room) return { ok: false, error: 'Room not found on booking' };

  const start = new Date(booking.start);
  const end = new Date(booking.end);
  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    return { ok: false, error: 'Invalid booking times' };
  }

  // Build identity for BHAiFi/Matrix
  let name = 'Visitor';
  let email = undefined;
  let phone = undefined;
  let externalUserId = undefined;
  let isGuest = false;

  if (booking.member) {
    const m = booking.member;
    name = [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Member';
    email = m.email || undefined;
    phone = m.phone || undefined;
  } else if (booking.guest) {
    const g = booking.guest;
    isGuest = true;
    name = g.name || 'Guest';
    email = g.email || undefined;
    phone = g.phone || undefined;
  }
  const userName = normalizePhoneToUserName(phone);
  externalUserId = userName || (booking.guest ? `guest:${String(booking.guest._id || booking.guest)}` : (booking.member ? `member:${String(booking.member._id || booking.member)}` : `booking:${String(booking._id)}`));

  const startDateString = fmt(start);
  const endDateString = fmt(end);

  // ---------- BHAiFi: ensure user + whitelist for slot ----------
  try {
    if (email && userName) {
      const nasId = getEnvNasId();
      let bhaifi = null;
      if (isGuest && booking.guest) {
        bhaifi = await BhaifiUser.findOne({ guest: booking.guest._id || booking.guest, userName });
        if (!bhaifi) {
          const apiRes = await bhaifiCreateUser({ email, idType: 1, name, nasId, userName });
          bhaifi = await BhaifiUser.create({
            guest: booking.guest._id || booking.guest,
            email,
            name,
            userName,
            idType: 1,
            nasId,
            bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
            status: 'active',
            lastSyncAt: new Date(),
            meta: { request: apiRes?.payload, response: apiRes?.data },
          });
        }
        await bhaifiWhitelist({ nasId: bhaifi.nasId || nasId, startDate: startDateString, endDate: endDateString, userName });
        try { await MeetingBooking.findByIdAndUpdate(booking._id, { $set: { 'buildingAccess.wifiAccess': true } }); } catch {}
      } else if (booking.member) {
        // Member-based Bhaifi user
        bhaifi = await BhaifiUser.findOne({ member: booking.member._id || booking.member, userName });
        if (!bhaifi) {
          const apiRes = await bhaifiCreateUser({ email, idType: 1, name, nasId, userName });
          bhaifi = await BhaifiUser.create({
            member: booking.member._id || booking.member,
            client: booking.member.client || null,
            email,
            name,
            userName,
            idType: 1,
            nasId,
            bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
            status: 'active',
            lastSyncAt: new Date(),
            meta: { request: apiRes?.payload, response: apiRes?.data },
          });
        }
        await bhaifiWhitelist({ nasId: bhaifi.nasId || nasId, startDate: startDateString, endDate: endDateString, userName });
        try { await MeetingBooking.findByIdAndUpdate(booking._id, { $set: { 'buildingAccess.wifiAccess': true } }); } catch {}
      }
    }
  } catch (e) {
    // Log to console; optional: integrate activity logger
    console.warn('[MeetingAccess][Bhaifi] Failed', { bookingId: String(booking._id), message: e?.message });
  }

  // ---------- Matrix: ensure user + set validity + assign devices ----------
  try {
    // Upsert local MatrixUser
    let mu = await MatrixUser.findOne({ externalUserId });
    if (!mu) {
      mu = await MatrixUser.create({
        buildingId: room.building?._id || room.building,
        name,
        phone,
        email,
        externalUserId,
        status: 'active',
        validTill: end,
      });
    } else {
      await MatrixUser.findByIdAndUpdate(mu._id, { $set: { validTill: end } });
    }

    // Create/upsert on Matrix COSEC and set access-validity-date
    try {
      await matrixApi.createUser({ id: externalUserId, name, email, phone, status: 'active', accessValidityDate: end });
    } catch (e) {
      console.warn('[MeetingAccess][Matrix] createUser failed', { message: e?.message });
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
          console.warn('[MeetingAccess][Matrix] assignUserToDevice failed', { device_id, message: assignErr?.message });
        }
      }
      if (assigned > 0) {
        try { await MatrixUser.findByIdAndUpdate(mu._id, { $set: { isDeviceAssigned: true, isEnrolled: true } }); } catch {}
        try { await MeetingBooking.findByIdAndUpdate(booking._id, { $set: { 'buildingAccess.matrixAccess': true } }); } catch {}
      }
    }
  } catch (e) {
    console.warn('[MeetingAccess][Matrix] Failed', { bookingId: String(booking._id), message: e?.message });
  }

  return { ok: true };
}

export default {
  provisionAccessForMeetingBooking,
};
