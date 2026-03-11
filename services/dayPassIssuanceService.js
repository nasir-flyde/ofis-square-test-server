import DayPass from "../models/dayPassModel.js";
import Visitor from "../models/visitorModel.js";
import User from "../models/userModel.js";
import Guest from "../models/guestModel.js";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import BhaifiUser from "../models/bhaifiUserModel.js";
import MatrixUser from "../models/matrixUserModel.js";
import AccessPolicy from "../models/accessPolicyModel.js";
import AccessPoint from "../models/accessPointModel.js";
import MatrixDevice from "../models/matrixDeviceModel.js";
import BhaifiNas from "../models/bhaifiNasModel.js";
import { bhaifiCreateUser, bhaifiWhitelist } from "../services/bhaifiService.js";
import matrixApi from "../utils/matrixApi.js";
import crypto from "crypto";

// Central issuance service for day passes
export const issueDayPass = async (dayPassId, session = null) => {
  try {
    const dayPass = await DayPass.findById(dayPassId)
      .populate('building')
      .session(session);

    if (!dayPass) {
      throw new Error("Day pass not found");
    }

    if (dayPass.status === "issued") {
      return { success: true, message: "Day pass already issued" };
    }

    // Update status to issued
    dayPass.status = "issued";

    // For "self" bookings: Populate pass details and grant building access without creating a redundant Visitor record
    if (!dayPass.visitorCreated && dayPass.bookingFor === "self") {
      await populatePassDetailsForSelf(dayPass, session);
      dayPass.visitorCreated = true;
      // Default auto-grant for self-bookings as requested
      dayPass.buildingAccess = {
        wifiAccess: true,
        accessControl: true
      };
      dayPass.status = "issued"; 
    }

    // For "other" bookings, create visitor if draft details exist
    if (!dayPass.visitorCreated && dayPass.bookingFor === "other" && dayPass.visitDate && dayPass.visitorDetailsDraft) {
      await createVisitorForOtherBooking(dayPass, session);
      dayPass.visitorCreated = true;
    }

    await dayPass.save({ session });

    // Non-blocking access provisioning for Day Passes
    try {
      await provisionAccessForDayPass(dayPass);
    } catch (provErr) {
      console.warn("[Provision] Day-pass provisioning failed", { dayPassId: String(dayPass._id), message: provErr?.message });
    }

    return { success: true, message: "Day pass issued successfully" };
  } catch (error) {
    console.error("Issuance error:", error);
    throw error;
  }
};

// Populate pass details from customer record for self bookings (skips Visitor collection)
const populatePassDetailsForSelf = async (dayPass, session) => {
  try {
    let customerDetails = null;

    // Try to find customer as Guest first
    customerDetails = await Guest.findById(dayPass.customer).session(session);

    // If not found as Guest, try as Member
    if (!customerDetails) {
      const memberDoc = await Member.findById(dayPass.customer)
        .populate('user')
        .session(session);
      if (memberDoc && memberDoc.user) {
        customerDetails = {
          name: memberDoc.user.name,
          email: memberDoc.user.email,
          phone: memberDoc.user.phone
        };
      }
    }

    // If still not found, try as Client
    if (!customerDetails) {
      const clientDoc = await Client.findById(dayPass.customer).session(session);
      if (clientDoc) {
        customerDetails = {
          name: clientDoc.contactPerson || clientDoc.companyName || 'Client',
          email: clientDoc.email || undefined,
          phone: clientDoc.phone || undefined
        };
      }
    }

    if (!customerDetails) {
      throw new Error("Customer details not found for self booking");
    }

    const visitDate = dayPass.visitDate ? new Date(dayPass.visitDate) : new Date();
    const departureTime = new Date(visitDate);
    departureTime.setHours(23, 59, 59, 999);

    const arrivalTime = new Date(visitDate);
    arrivalTime.setHours(0, 0, 0, 0);

    // Update day pass with visitor details directly
    dayPass.visitorName = customerDetails.name;
    dayPass.visitorPhone = customerDetails.phone;
    dayPass.visitorEmail = customerDetails.email;
    dayPass.expectedArrivalTime = arrivalTime;
    dayPass.expectedDepartureTime = departureTime;
    dayPass.date = visitDate;
    dayPass.qrCode = crypto.randomBytes(16).toString('hex');
    dayPass.qrExpiresAt = departureTime;

    console.log(`Populated self-booking details for: ${customerDetails.name}`);
  } catch (error) {
    console.error("Error populating self-booking details:", error);
    throw error;
  }
};

// Create visitor record for other bookings using draft details
const createVisitorForOtherBooking = async (dayPass, session) => {
  try {
    const draft = dayPass.visitorDetailsDraft;

    if (!draft || !draft.name) {
      // Do not block issuance if draft is incomplete; allow managing visitor later
      console.warn("Visitor draft details incomplete for other booking; skipping visitor creation");
      return; // gracefully skip
    }

    // Set full day time window (00:00 to 23:59)
    const visitDate = new Date(dayPass.visitDate);
    const arrivalTime = new Date(visitDate);
    arrivalTime.setHours(0, 0, 0, 0);

    const departureTime = new Date(visitDate);
    departureTime.setHours(23, 59, 59, 999);

    // Update day pass with visitor details from draft
    dayPass.visitorName = draft.name;
    dayPass.visitorPhone = draft.phone;
    dayPass.visitorEmail = draft.email;
    dayPass.visitorCompany = draft.company;
    dayPass.purpose = draft.purpose;
    dayPass.expectedArrivalTime = arrivalTime;
    dayPass.expectedDepartureTime = departureTime;
    dayPass.date = visitDate; // Set actual visit date

    console.log(`Created visitor record for other booking: ${draft.name} on ${visitDate.toDateString()}`);
  } catch (error) {
    console.error("Error creating visitor for other booking:", error);
    throw error;
  }
};

// Batch issue multiple day passes
export const issueDayPassBatch = async (dayPassIds, session = null) => {
  const results = [];

  for (const passId of dayPassIds) {
    try {
      const result = await issueDayPass(passId, session);
      results.push({ passId, ...result });
    } catch (error) {
      results.push({ passId, success: false, error: error.message });
    }
  }

  return results;
};

// ------------------ Provisioning helpers for Guest Day Pass ------------------

const getEnvNasId = () => process.env.BHAIFI_DEFAULT_NAS_ID || "test_39_1";

const normalizePhoneToUserName = (phone) => {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  p = p.replace(/^0+/, "");
  if (p.startsWith("91")) p = p.replace(/^91+/, "");
  if (p.length > 10) p = p.slice(-10);
  if (p.length !== 10) return null;
  return `91${p}`;
};

const formatDateTime = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
};

const buildDayWindowForBuilding = (building, baseDate) => {
  const opening = (building?.openingTime || '09:00').split(':');
  const closing = (building?.closingTime || '19:00').split(':');
  const start = new Date(baseDate);
  start.setHours(Number(opening[0] || '9'), Number(opening[1] || '0'), 0, 0);
  const end = new Date(baseDate);
  end.setHours(Number(closing[0] || '19'), Number(closing[1] || '0'), 0, 0);
  return {
    startDateString: formatDateTime(start),
    endDateString: formatDateTime(end),
    start,
    end,
  };
};

export async function provisionAccessForDayPass(dayPassDoc) {
  try {
    const building = dayPassDoc.building || (await DayPass.findById(dayPassDoc._id).populate('building')).building;
    if (!building) return;

    // customer mapping for backward compatibility if needed in old code paths
    let guestIdRef = null;
    try {
      if (dayPassDoc.customer) {
        const gdoc = await Guest.findById(dayPassDoc.customer).lean();
        if (gdoc) guestIdRef = gdoc._id;
      }
    } catch (e) { }

    const visitDate = dayPassDoc.date || dayPassDoc.visitDate || new Date();
    const { startDateString, endDateString, end } = buildDayWindowForBuilding(building, new Date(visitDate));

    // ------- BhaiFi: ensure user + whitelist for the day -------
    try {
      const name = dayPassDoc.visitorName || 'Guest';
      const email = dayPassDoc.visitorEmail || null;
      const phone = dayPassDoc.visitorPhone || null;
      const userName = normalizePhoneToUserName(phone);
      if (email && userName) {
        let bhaifi = null;
        if (guestIdRef) {
          bhaifi = await BhaifiUser.findOne({ guest: guestIdRef, userName });
        } else {
          bhaifi = await BhaifiUser.findOne({ userName });
        }
        // Resolve NAS list from building.wifiAccess.daypass; fallback to default env NAS
        let nasIds = [];
        try {
          const dpCfg = building?.wifiAccess?.daypass || {};
          const refIds = Array.isArray(dpCfg?.nasRefs) ? dpCfg.nasRefs : [];
          if (dpCfg?.enabled && refIds.length) {
            const nasDocs = await BhaifiNas.find({ _id: { $in: refIds }, isActive: true }).select('nasId').lean();
            nasIds = nasDocs.map(d => d.nasId).filter(Boolean);
          }
        } catch (_) { }
        if (!Array.isArray(nasIds) || nasIds.length === 0) {
          nasIds = [getEnvNasId()];
        }
        const nasId = nasIds[0];
        const idType = 1;
        if (!bhaifi) {
          const apiRes = await bhaifiCreateUser({ email, idType, name, nasId, userName });
          bhaifi = await BhaifiUser.create({
            ...(guestIdRef ? { guest: guestIdRef } : {}),
            email,
            name,
            userName,
            idType,
            nasId,
            bhaifiUserId: apiRes?.data?.id || apiRes?.data?.userId || null,
            status: 'active',
            lastSyncAt: new Date(),
            meta: { request: apiRes?.payload, response: apiRes?.data },
          });
        }
        // Whitelist across all configured NAS for the day
        for (const nid of nasIds) {
          try {
            await bhaifiWhitelist({ nasId: nid, startDate: startDateString, endDate: endDateString, userName });
          } catch (wlErr) {
            console.warn('[Provision][Bhaifi] whitelist failed for NAS', { nasId: nid, userName, msg: wlErr?.message });
          }
        }
        const startAt = new Date(String(startDateString).replace(' ', 'T'));
        const endAt = new Date(String(endDateString).replace(' ', 'T'));
        bhaifi.lastWhitelistedAt = new Date();
        bhaifi.whitelistActiveUntil = isNaN(endAt.getTime()) ? undefined : endAt;
        bhaifi.lastSyncAt = new Date();
        bhaifi.status = 'active';
        bhaifi.whitelistHistory = Array.isArray(bhaifi.whitelistHistory) ? bhaifi.whitelistHistory : [];
        bhaifi.whitelistHistory.push({
          startDateString,
          endDateString,
          startAt: isNaN(startAt.getTime()) ? undefined : startAt,
          endAt: isNaN(endAt.getTime()) ? undefined : endAt,
          requestedBy: null,
          source: 'system',
          response: undefined,
        });
        await bhaifi.save();
        // Mark wifi access granted for this Day Pass
        try {
          await DayPass.findByIdAndUpdate(dayPassDoc._id, { $set: { 'buildingAccess.wifiAccess': true } });
        } catch (markErr) {
          console.warn('[Provision][Bhaifi] Failed to mark wifiAccess=true on DayPass', { dayPassId: String(dayPassDoc._id), message: markErr?.message });
        }
      } else {
        console.warn('[Provision][Bhaifi] Skipping: missing email or valid phone for day pass', { dayPassId: String(dayPassDoc._id) });
      }
    } catch (e) {
      console.warn('[Provision][Bhaifi] Failed', { dayPassId: String(dayPassDoc._id), message: e?.message });
    }

    // ------- Matrix: ensure user, set validTill, assign devices by building policy -------
    try {
      const name = dayPassDoc.visitorName || 'Guest';
      const email = dayPassDoc.visitorEmail || undefined;
      const phone = dayPassDoc.visitorPhone || undefined;
      const normalizedPhone = normalizePhoneToUserName(phone);
      const externalUserId = normalizedPhone || (guestIdRef ? `guest:${String(guestIdRef)}` : `daypass:${String(dayPassDoc._id)}`);

      let mu = await MatrixUser.findOne({ externalUserId });
      if (!mu) {
        mu = await MatrixUser.create({
          buildingId: building._id,
          name,
          phone,
          email,
          externalUserId,
          status: 'active',
          policyId: building.dayPassMatrixPolicyId || null,
          validTill: end,
        });
      } else {
        // Update validity and policy if needed
        const updates = { validTill: end };
        if (building.dayPassMatrixPolicyId && String(mu.policyId || '') !== String(building.dayPassMatrixPolicyId)) {
          updates.policyId = building.dayPassMatrixPolicyId;
        }
        await MatrixUser.findByIdAndUpdate(mu._id, { $set: updates });
      }

      // Create/Upsert on Matrix COSEC and set access-validity-date
      try {
        await matrixApi.createUser({ id: externalUserId, name, email, phone, status: 'active', accessValidityDate: end });
      } catch (e) {
        console.warn('[Provision][Matrix] createUser failed (COSEC)', { message: e?.message });
      }

      // Assign via policy
      if (building.dayPassMatrixPolicyId) {
        try {
          const policy = await AccessPolicy.findById(building.dayPassMatrixPolicyId).select('accessPointIds').lean();
          if (policy && Array.isArray(policy.accessPointIds) && policy.accessPointIds.length) {
            const accessPoints = await AccessPoint.find({ _id: { $in: policy.accessPointIds } }).select('deviceBindings').lean();
            const deviceIdStrings = [];
            for (const ap of accessPoints) {
              const bindings = Array.isArray(ap?.deviceBindings) ? ap.deviceBindings : [];
              for (const b of bindings) {
                if ((b?.vendor === 'MATRIX_COSEC') && b?.deviceId) {
                  deviceIdStrings.push(String(b.deviceId));
                }
              }
            }
            const uniqueDeviceObjIds = Array.from(new Set(deviceIdStrings));
            if (uniqueDeviceObjIds.length) {
              const devices = await MatrixDevice.find({ _id: { $in: uniqueDeviceObjIds } }).select('device_id').lean();
              let assigned = 0;
              for (const d of devices) {
                const device_id = d?.device_id;
                if (!device_id) continue;
                try {
                  const resp = await matrixApi.assignUserToDevice({ device_id, externalUserId });
                  if (resp?.ok) assigned += 1;
                } catch (assignErr) {
                  console.warn('[Provision][Matrix] assignUserToDevice failed', { device_id, message: assignErr?.message });
                }
              }
              if (assigned > 0) {
                try { await MatrixUser.findByIdAndUpdate(mu._id, { $set: { isDeviceAssigned: true, isEnrolled: true } }); } catch { }
              }
            }
          }
        } catch (polErr) {
          console.warn('[Provision][Matrix] Policy assignment failed', { message: polErr?.message });
        }
      }
    } catch (e) {
      console.warn('[Provision][Matrix] Failed', { dayPassId: String(dayPassDoc._id), message: e?.message });
    }
  } catch (err) {
    console.warn('[Provision] Skipping provisioning due to error', { message: err?.message });
  }
}
