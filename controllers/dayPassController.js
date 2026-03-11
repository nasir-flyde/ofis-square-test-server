import DayPass from "../models/dayPassModel.js";
import DayPassBundle from "../models/dayPassBundleModel.js";
import Building from "../models/buildingModel.js";
import Guest from "../models/guestModel.js";
import Visitor from "../models/visitorModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Invoice from "../models/invoiceModel.js";
import ClientCreditWallet from "../models/clientCreditWalletModel.js";
import Contract from "../models/contractModel.js";
import CreditTransaction from "../models/creditTransactionModel.js";
import Payment from "../models/paymentModel.js";
import { logBookingActivity, logPaymentActivity, logErrorActivity } from "../utils/activityLogger.js";
import crypto from "crypto";
import mongoose from "mongoose";
import { sendNotification } from "../utils/notificationHelper.js";
import DayPassDailyUsage from "../models/dayPassDailyUsageModel.js";
import loggedRazorpay from "../utils/loggedRazorpay.js";
import { recordCancellation } from "./cancelledBookingController.js";
import { pushInvoiceToZoho } from "../utils/loggedZohoBooks.js";

// Helper: convert any date-like to IST Date object (ending in Z for wall-time)
function toIST(date) {
  try {
    const d = new Date(date);
    const s = d.toLocaleString('en-ZA', { timeZone: 'Asia/Kolkata', hour12: false }).replace(',', 'T').replace(' ', '');
    const iso = s.replace(/\//g, '-') + 'Z';
    return new Date(iso);
  } catch (e) {
    return new Date(date);
  }
}

function startOfDayIST(date) {
  const d = toIST(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}


// Helpers: normalize date and check capacity for building/inventory/date
const normalizeStartOfDay = (d) => {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const findInventoryById = (building, inventoryId) => {
  if (!inventoryId) return null;
  try {
    const inv = (building?.dayPassInventories || []).find((i) => String(i?._id) === String(inventoryId));
    return inv || null;
  } catch {
    return null;
  }
};

// Daily capacity tracking helpers (single-key per building)
const getDailyUsageCount = async (buildingId, date) => {
  const start = normalizeStartOfDay(date);
  const usage = await DayPassDailyUsage.findOne({ building: buildingId, date: start }).lean();
  return usage?.bookedCount || 0;
};

// Reserve one slot for the given building/date, honoring building.dayPassDailyCapacity
// Must be called within a session/transaction for atomicity with booking changes
const reserveDailyCapacity = async (buildingDoc, date, session) => {
  const start = normalizeStartOfDay(date);
  const cap = Number(buildingDoc?.dayPassDailyCapacity || 0);
  // Increment bookedCount; on transaction commit this becomes visible
  const updated = await DayPassDailyUsage.findOneAndUpdate(
    { building: buildingDoc._id, date: start },
    { $inc: { bookedCount: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
  if (cap > 0 && updated.bookedCount > cap) {
    const err = new Error('No availability for this date at the building');
    err.status = 409;
    err.details = { capacity: cap, booked: updated.bookedCount - 1, remaining: 0 };
    throw err;
  }
  return { capacity: cap || null, booked: updated.bookedCount, remaining: cap > 0 ? Math.max(0, cap - updated.bookedCount) : null };
};

// Create single day pass (not from bundle)
export const createSingleDayPass = async (req, res) => {
  try {
    let { customerId, memberId, buildingId, notes, bookingFor, visitDate, inventoryId } = req.body;

    // Automate customerId from token if not provided
    if (!customerId && req.user) {
      if (req.user.guestId) {
        customerId = req.user.guestId;
      } else if (req.user.memberId) {
        customerId = req.user.memberId;
      }
    }

    // Automate memberId from token if not provided
    if (!memberId && req.user && req.user.memberId) {
      memberId = req.user.memberId;
    }

    if (!customerId || !buildingId) {
      return res.status(400).json({
        error: "Customer ID and Building ID are required"
      });
    }

    // Validate new required fields
    if (!bookingFor || !['self', 'other'].includes(bookingFor)) {
      return res.status(400).json({
        error: "bookingFor must be 'self' or 'other'"
      });
    }

    // Only require visitDate for "self" bookings
    if (bookingFor === "self" && !visitDate) {
      return res.status(400).json({
        error: "visitDate is required for self bookings"
      });
    }

    let parsedVisitDate = null;
    if (visitDate) {
      parsedVisitDate = new Date(visitDate);
      if (isNaN(parsedVisitDate.getTime())) {
        return res.status(400).json({
          error: "Invalid visitDate format"
        });
      }
    }

    // Verify customer exists - could be Guest, Member, or Client
    let customer = null;
    let customerType = 'guest';

    // First try to find as Guest
    customer = await Guest.findById(customerId);

    // If not found as Guest, try as Member
    if (!customer) {
      const Member = (await import('../models/memberModel.js')).default;
      customer = await Member.findById(customerId);
      if (customer) {
        customerType = 'member';
      }
    }

    // If still not found, try as Client
    if (!customer) {
      const Client = (await import('../models/clientModel.js')).default;
      customer = await Client.findById(customerId);
      if (customer) {
        customerType = 'client';
      }
    }

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Attach buildingId to guest table for ondemanduser role
    if (req.user?.roleName?.toLowerCase() === 'ondemanduser' && customerType === 'guest') {
      try {
        await Guest.findByIdAndUpdate(customerId, { buildingId: buildingId });
      } catch (updateErr) {
        console.warn("Failed to attach buildingId to guest record:", updateErr.message);
        // Non-blocking: proceed with pass creation even if guest update fails
      }
    }

    // If attempting credit payment, enforce member credit usage permission
    const requestedPaymentMethod = (req.body?.paymentMethod || '').toLowerCase();
    if (requestedPaymentMethod === 'credits') {
      // Determine the relevant member to check: prefer provided memberId, else if customer is a member
      let memberLookupId = memberId || (customerType === 'member' ? customerId : null);
      if (memberLookupId) {
        try {
          const m = await Member.findById(memberLookupId).select('allowedUsingCredits status');
          if (!m) {
            return res.status(404).json({ error: 'Member not found for credit payment' });
          }
          if (m.status !== 'active') {
            return res.status(403).json({ error: 'Member is inactive', code: 'MEMBER_INACTIVE' });
          }
          if (m.allowedUsingCredits === false) {
            return res.status(403).json({ error: 'This member is not allowed to use credits', code: 'CREDITS_NOT_ALLOWED' });
          }
        } catch (_) {
          return res.status(500).json({ error: 'Failed to validate member credit permission' });
        }
      }
    }

    // Verify building exists and get pricing
    const building = await Building.findById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }

    if (!building.openSpacePricing && !(Array.isArray(building.dayPassInventories) && building.dayPassInventories.length)) {
      return res.status(400).json({
        error: "Day pass pricing/inventory not configured for this building"
      });
    }

    // Resolve price: prefer selected inventory's price if provided
    let price = building.openSpacePricing;
    let selectedInventory = null;
    if (inventoryId) {
      selectedInventory = findInventoryById(building, inventoryId);
      if (!selectedInventory) {
        return res.status(400).json({ error: 'Selected inventory not found for building' });
      }
      if (selectedInventory.isActive === false) {
        return res.status(400).json({ error: 'Selected inventory is not active' });
      }
      price = selectedInventory.price;
    }
    if (typeof price !== 'number' || Number.isNaN(price)) {
      return res.status(400).json({ error: 'Day pass price not configured' });
    }
    const gstRate = 18; // Apply 18% GST
    const taxAmount = Math.round(((price * gstRate) / 100) * 100) / 100;
    const totalAmount = Math.round(((price + taxAmount)) * 100) / 100;

    // Set booking date (today) and expiry at end of day
    const bookingDate = new Date();
    // If visitDate is provided, set expiresAt to end of that day; otherwise end of current day
    const expiresAt = parsedVisitDate ? new Date(parsedVisitDate) : new Date();
    bookingDate.setHours(0, 0, 0, 0); // Normalize bookingDate to start of day for consistency
    expiresAt.setHours(23, 59, 59, 999);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Reserve daily capacity for known self visit date
      if (bookingFor === 'self' && parsedVisitDate) {
        try {
          await reserveDailyCapacity(building, parsedVisitDate, session);
        } catch (capErr) {
          const code = capErr.status || 409;
          return res.status(code).json({ error: capErr.message, ...(capErr.details ? { details: capErr.details } : {}) });
        }
      }

      // Create day pass with payment_pending status
      const dayPass = new DayPass({
        customer: customerId,
        member: customerType === 'member' ? customerId : (memberId || null),
        building: buildingId,
        bundle: null, // Single pass, not from bundle
        // Use booking date as the day for the pass; invitation can still set visitor/date later
        date: bookingDate,
        visitDate: parsedVisitDate,
        bookingFor,
        expiresAt,
        price,
        status: "payment_pending",
        notes,
        createdBy: req.user?._id,
        inventoryId: inventoryId ? String(inventoryId) : undefined,
      });

      await dayPass.save({ session });

      let invoice = null;
      let clientIdForInvoice = req.clientId || null;

      if (!clientIdForInvoice) {
        const memberLookupId = customerType === 'member' ? customerId : (memberId || null);
        if (memberLookupId) {
          try {
            const memberDoc = await Member.findById(memberLookupId).select('client');
            if (memberDoc?.client) clientIdForInvoice = memberDoc.client;
          } catch (_) { }
        }
      }
      if (!clientIdForInvoice && customerType === 'client') {
        clientIdForInvoice = customerId;
      }

      const paymentMethod = (req.body?.paymentMethod || '').toLowerCase();
      const creditsPerPass = building.creditValue || 500;
      const creditsRequired = paymentMethod === 'credits' ? Math.ceil(totalAmount / creditsPerPass) : 0;
      const creditSuffix = creditsRequired > 0 ? ` (${creditsRequired} Credits)` : '';

      invoice = new Invoice({
        client: clientIdForInvoice,
        guest: clientIdForInvoice ? null : (customerType !== 'client' ? customerId : null),
        building: buildingId,
        type: "regular",
        category: "day_pass",
        invoice_number: `DP-${Date.now()}`,
        line_items: [{
          description: `Day Pass - ${building.name}${selectedInventory ? ` (${selectedInventory.inventoryType || 'Open Space'})` : ''}${creditSuffix}`,
          quantity: 1,
          unitPrice: price,
          amount: price,
          rate: price,
          tax_percentage: gstRate
        }],
        sub_total: price,
        tax_total: taxAmount,
        total: totalAmount,
        status: "draft",
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      await invoice.save({ session });

      dayPass.invoice = invoice._id;
      await dayPass.save({ session });

      await session.commitTransaction();

      // Push invoice to Zoho Books (non-blocking, after DB commit)
      if (invoice) {
        // Resolve client for Zoho
        let clientForZoho = null;
        try {
          if (clientIdForInvoice) {
            const Client = (await import('../models/clientModel.js')).default;
            clientForZoho = await Client.findById(clientIdForInvoice).select('zohoBooksContactId email companyName');
          } else if (customerType === 'member') {
            const memberDoc = await Member.findById(customerId).populate('client');
            clientForZoho = memberDoc?.client || null;
            if (clientForZoho) {
              const Client = (await import('../models/clientModel.js')).default;
              clientForZoho = await Client.findById(clientForZoho).select('zohoBooksContactId email companyName');
            }
          }

          if (clientForZoho) {
            pushInvoiceToZoho(invoice, clientForZoho, { userId: req.user?._id }).catch(e =>
              console.warn('[DayPass] Zoho invoice push failed (non-blocking):', e?.message)
            );
          }
        } catch (zohoErr) {
          console.warn('[DayPass] Could not resolve client for Zoho push:', zohoErr?.message);
        }
      }

      await dayPass.populate([
        { path: 'customer', select: 'name email phone' },
        { path: 'building', select: 'name address openSpacePricing creditValue' },
        { path: 'invoice', select: 'invoice_number total status' }
      ]);

      await logBookingActivity(req, 'CREATE', 'DayPass', dayPass._id, {
        customerId,
        memberId,
        buildingId,
        date: bookingDate,
        totalAmount
      });

      // Notify booking customer - Day Pass booking confirmed
      try {
        const to = {};
        // Prefer customer's email on populated document
        if (dayPass.customer?.email) to.email = dayPass.customer.email;
        if (to.email) {
          await sendNotification({
            to,
            channels: { email: true, sms: false },
            templateKey: 'day_pass_booking_confirmed',
            templateVariables: {
              greeting: "Ofis Sqaure",
              memberName: dayPass.customer?.companyName || dayPass.customer?.name || 'Member',
              companyName: dayPass.customer?.companyName || 'Ofis Square',
              building: dayPass.building?.name,
              date: bookingDate.toISOString().slice(0, 10),
              bookingId: String(dayPass._id)
            },
            title: 'Day Pass Booking Confirmed',
            metadata: {
              category: 'day_pass',
              tags: ['day_pass_booking_confirmed'],
              route: `/day-passes/${dayPass._id}`,
              deepLink: `ofis://day-passes/${dayPass._id}`,
              routeParams: { id: String(dayPass._id) }
            },
            source: 'system',
            type: 'transactional'
          });
        }
      } catch (notifyErr) {
        console.warn('createSingleDayPass: failed to send day_pass_booking_confirmed notification:', notifyErr?.message || notifyErr);
      }

      const responseData = {
        dayPass,
      };
      if (invoice) {
        responseData.invoice = invoice;
      }
      
      // We no longer create Razorpay orders automatically here. 
      // The frontend should call /api/payments/razorpay/create-order explicitly 
      // using the dayPassId returned in this response.
      if (paymentMethod !== 'credits') {
        responseData.razorpayKey = process.env.RAZORPAY_KEY_ID;
        responseData.amount = totalAmount * 100;
        responseData.currency = 'INR';
      }

      res.status(201).json({
        success: true,
        message: 'Day pass created successfully',
        data: responseData
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("createSingleDayPass error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Invite visitor to a day pass (assign date and generate QR)
export const inviteVisitor = async (req, res) => {
  try {
    try {
      const { dayPassId } = req.params;
      const {
        date,
        visitorName,
        visitorPhone,
        visitorEmail,
        visitorCompany,
        purpose,
        numberOfGuests = 1,
        expectedArrivalTime,
        expectedDepartureTime,
        inventoryId,
      } = req.body;

      if (!date || !visitorName) {
        return res.status(400).json({ error: "Date and visitor name are required" });
      }

      const dayPass = await DayPass.findById(dayPassId)
        .populate('customer', 'name email phone')
        .populate('building', 'name address creditValue');

      if (!dayPass) {
        return res.status(404).json({ error: "Day pass not found" });
      }

      // Check if day pass is issued (payment completed)
      if (dayPass.status !== 'issued') {
        return res.status(400).json({
          error: "Day pass must be paid for before inviting visitors",
          currentStatus: dayPass.status,
          requiredStatus: 'issued'
        });
      }

      // Set host information from JWT via hostMiddleware (req.hostInfo)
      if (req.hostInfo?.type && req.hostInfo?.id) {
        if (req.hostInfo.type === 'member') {
          dayPass.hostMember = req.hostInfo.id;
          dayPass.hostClient = null;
          dayPass.hostGuest = null;
        } else if (req.hostInfo.type === 'client') {
          dayPass.hostClient = req.hostInfo.id;
          dayPass.hostMember = null;
          dayPass.hostGuest = null;
        } else if (req.hostInfo.type === 'guest') {
          dayPass.hostGuest = req.hostInfo.id;
          dayPass.hostMember = null;
          dayPass.hostClient = null;
        }
      }

      // Set the pass date
      const passDate = new Date(date);
      passDate.setHours(0, 0, 0, 0);

      // Reserve daily capacity for the invite date within a transaction
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const building = await Building.findById(dayPass.building).session(session);
        const seatCount = Math.max(1, parseInt(numberOfGuests) || 1);
        // Capacity check using combined usage (bundle seats + partner counters)
        const existingUsages = await DayPassDailyUsage.find({ building: building._id, date: passDate })
          .select('seats bookedCount dayPass')
          .session(session)
          .lean();
        // Exclude any existing row for this same dayPass to avoid double-count if re-inviting the same pass
        const existingForThisPass = (existingUsages || []).find(u => String(u.dayPass) === String(dayPass._id));
        const totalBookedRaw = (existingUsages || []).reduce((sum, u) => sum + (Number(u.seats) || 0) + (Number(u.bookedCount) || 0), 0);
        const alreadyBooked = totalBookedRaw - (existingForThisPass ? (Number(existingForThisPass.seats) || 0) : 0);
        const totalCapacity = Number(building.dayPassDailyCapacity || 0);
        if (totalCapacity > 0 && (alreadyBooked + seatCount) > totalCapacity) {
          const err = new Error('No availability for this date at the building');
          err.status = 409;
          err.details = { capacity: totalCapacity, booked: alreadyBooked, requested: seatCount, remaining: Math.max(0, totalCapacity - alreadyBooked) };
          throw err;
        }
        // Record or update usage row for this day pass
        await DayPassDailyUsage.findOneAndUpdate(
          { building: building._id, date: passDate, dayPass: dayPass._id },
          { $set: { seats: seatCount } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );

        // Set the pass date and visitor details
        dayPass.date = passDate;
        dayPass.visitorName = visitorName;
        dayPass.visitorPhone = visitorPhone;
        dayPass.visitorEmail = visitorEmail;
        dayPass.visitorCompany = visitorCompany;
        dayPass.purpose = purpose;
        dayPass.numberOfGuests = Math.max(1, parseInt(numberOfGuests) || 1);
        // Helper to merge a "HH:MM" time into a given date
        const buildDateTime = (baseDate, timeStr) => {
          if (!timeStr || typeof timeStr !== 'string') return null;
          const [hh, mm] = timeStr.split(':').map((v) => parseInt(v, 10));
          if (
            Number.isNaN(hh) || Number.isNaN(mm) ||
            hh < 0 || hh > 23 || mm < 0 || mm > 59
          ) {
            return null;
          }
          const dt = new Date(baseDate);
          dt.setHours(hh, mm, 0, 0);
          return dt;
        };

        const arrivalDT = buildDateTime(passDate, expectedArrivalTime);
        const departureDT = buildDateTime(passDate, expectedDepartureTime);

        dayPass.expectedArrivalTime = arrivalDT || null;
        dayPass.expectedDepartureTime = departureDT || null;
        dayPass.status = "invited";
        dayPass.invitedAt = new Date();

        // Generate QR code and set expiry
        const qrData = {
          passId: dayPass._id,
          visitorName,
          date: passDate.toISOString(),
          buildingId: dayPass.building._id,
          type: 'day_pass'
        };

        dayPass.qrCode = Buffer.from(JSON.stringify(qrData)).toString('base64');

        // Set QR expiry to end of pass date
        const qrExpiry = new Date(passDate);
        qrExpiry.setHours(23, 59, 59, 999);
        dayPass.qrExpiresAt = qrExpiry;

        await dayPass.save({ session });

        // Populate building for response (host details are stored on Visitor)
        await dayPass.populate([{ path: 'building', select: 'name' }]);

        // Also create a Visitor record linked to this DayPass
        const visitorDoc = new Visitor({
          name: visitorName,
          email: visitorEmail,
          phone: visitorPhone,
          companyName: visitorCompany,
          purpose,
          numberOfGuests: Math.max(1, parseInt(numberOfGuests) || 1),
          expectedVisitDate: passDate,
          expectedArrivalTime: arrivalDT || null,
          expectedDepartureTime: departureDT || null,
          hostMember: dayPass.hostMember || undefined,
          hostClient: dayPass.hostClient || undefined,
          hostGuest: dayPass.hostGuest || undefined,
          status: 'invited',
          building: dayPass.building,
          dayPass: dayPass._id,
          createdBy: req.user?._id || undefined,
          // Keep QR in sync with DayPass
          qrToken: dayPass.qrCode,
          qrExpiresAt: dayPass.qrExpiresAt,
        });

        await visitorDoc.save({ session });

        // Attach visitor to day pass visitors array
        try {
          const current = Array.isArray(dayPass.visitors) ? dayPass.visitors : [];
          dayPass.visitors = [...current, visitorDoc._id];
          await dayPass.save({ session });
        } catch (e) {
          console.warn("Failed to append visitor to day pass visitors array:", e?.message || e);
        }

        await session.commitTransaction();
        session.endSession();

        // Send notifications: visitor and host/booker - Day Pass booking confirmed
        try {
          // Visitor notification (email)
          if (visitorEmail) {
            await sendNotification({
              to: { email: visitorEmail },
              channels: { email: true, sms: false },
              templateKey: 'day_pass_booking_confirmed',
              templateVariables: {
                memberName: visitorName || 'Guest',
                companyName: 'Ofis Square',
                building: dayPass.building?.name,
                date: passDate.toISOString().slice(0, 10),
                bookingId: String(dayPass._id)
              },
              title: 'Day Pass Booking Confirmed',
              metadata: {
                category: 'day_pass',
                tags: ['day_pass_booking_confirmed', 'visitor'],
                route: `/visitor/day-passes/${dayPass._id}`,
                deepLink: `ofis://visitor/day-passes/${dayPass._id}`,
                routeParams: { id: String(dayPass._id) }
              },
              source: 'system',
              type: 'transactional'
            });
          }

          // Host/booker notification (member/client/guest)
          let hostEmail = null;
          if (dayPass.hostMember?.email) hostEmail = dayPass.hostMember.email;
          else if (dayPass.hostClient?.email) hostEmail = dayPass.hostClient.email;
          else if (dayPass.customer?.email) hostEmail = dayPass.customer.email;

          if (hostEmail) {
            await sendNotification({
              to: { email: hostEmail },
              channels: { email: true, sms: false },
              templateKey: 'day_pass_booking_confirmed',
              templateVariables: {
                memberName: hostEmail === dayPass.customer?.email ? (dayPass.customer?.companyName || dayPass.customer?.name) : 'Host',
                companyName: 'Ofis Square',
                building: dayPass.building?.name,
                date: passDate.toISOString().slice(0, 10),
                bookingId: String(dayPass._id)
              },
              title: 'Day Pass Booking Confirmed',
              metadata: {
                category: 'day_pass',
                tags: ['day_pass_booking_confirmed', 'host'],
                route: `/day-passes/${dayPass._id}`,
                deepLink: `ofis://day-passes/${dayPass._id}`,
                routeParams: { id: String(dayPass._id) }
              },
              source: 'system',
              type: 'transactional'
            });
          }
        } catch (notifyErr) {
          console.warn('inviteVisitor: failed to send day pass confirmation notifications:', notifyErr?.message || notifyErr);
        }

        // Schedule reminder notifications to visitor and host/booker
        try {
          const reminderMinutes = Number(process.env.DAY_PASS_REMINDER_MINUTES_BEFORE || 60);
          // Prefer specific expectedArrivalTime if provided; else 10:00 AM on pass date
          const defaultArrival = new Date(passDate);
          defaultArrival.setHours(10, 0, 0, 0);
          const arrivalTime = arrivalDT || defaultArrival;
          const scheduledAt = new Date(arrivalTime.getTime() - reminderMinutes * 60000);
          const now = new Date();
          if (scheduledAt > now) {
            const arrivalTimeStr = arrivalTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
            const dateStr = passDate.toISOString().slice(0, 10);

            // Visitor reminder
            if (visitorEmail) {
              await sendNotification({
                to: { email: visitorEmail },
                channels: { email: true, sms: false },
                templateKey: 'day_pass_booking_reminder',
                templateVariables: {
                  memberName: visitorName || 'Guest',
                  companyName: 'Ofis Square',
                  building: dayPass.building?.name,
                  date: dateStr,
                  time: arrivalTimeStr,
                  bookingId: String(dayPass._id)
                },
                title: 'Day Pass Reminder',
                metadata: {
                  category: 'day_pass',
                  tags: ['day_pass_booking_reminder', 'visitor'],
                  route: `/visitor/day-passes/${dayPass._id}`,
                  deepLink: `ofis://visitor/day-passes/${dayPass._id}`,
                  routeParams: { id: String(dayPass._id) }
                },
                source: 'system',
                type: 'reminder',
                scheduledAt
              });
            }

            // Host/booker reminder
            let hostEmailForReminder = null;
            if (dayPass.hostMember?.email) hostEmailForReminder = dayPass.hostMember.email;
            else if (dayPass.hostClient?.email) hostEmailForReminder = dayPass.hostClient.email;
            else if (dayPass.customer?.email) hostEmailForReminder = dayPass.customer.email;

            if (hostEmailForReminder) {
              await sendNotification({
                to: { email: hostEmailForReminder },
                channels: { email: true, sms: false },
                templateKey: 'day_pass_booking_reminder',
                templateVariables: {
                  memberName: hostEmailForReminder === dayPass.customer?.email ? (dayPass.customer?.companyName || dayPass.customer?.name) : 'Host',
                  companyName: 'Ofis Square',
                  building: dayPass.building?.name,
                  date: dateStr,
                  time: arrivalTimeStr,
                  bookingId: String(dayPass._id)
                },
                title: 'Day Pass Reminder',
                metadata: {
                  category: 'day_pass',
                  tags: ['day_pass_booking_reminder', 'host'],
                  route: `/day-passes/${dayPass._id}`,
                  deepLink: `ofis://day-passes/${dayPass._id}`,
                  routeParams: { id: String(dayPass._id) }
                },
                source: 'system',
                type: 'reminder',
                scheduledAt
              });
            }
          }
        } catch (remErr) {
          console.warn('inviteVisitor: failed to schedule day pass reminders:', remErr?.message || remErr);
        }

        // TODO: Send invitation email with QR code similar to visitor system

        res.json({
          message: "Visitor invited successfully",
          dayPass,
          visitor: {
            id: visitorDoc._id,
            name: visitorDoc.name,
            qrToken: visitorDoc.qrToken,
            expectedVisitDate: visitorDoc.expectedVisitDate,
            status: visitorDoc.status,
          },
          qrCode: dayPass.qrCode,
          qrUrl: `${req.protocol}://${req.get('host')}/day-passes/scan?qr=${dayPass.qrCode}`
        });

      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      console.error("inviteVisitor error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  } catch (error) {
    console.error("inviteVisitor error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
// Check-in with QR code
export const checkInWithQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    // Check if pass is valid for today
    const today = new Date();
    const passDate = new Date(dayPass.date);

    if (passDate.toDateString() !== today.toDateString()) {
      return res.status(400).json({ error: "Day pass is not valid for today" });
    }

    if (dayPass.status !== "invited" && dayPass.status !== "issued") {
      return res.status(400).json({
        error: `Cannot check-in. Pass status: ${dayPass.status}`
      });
    }

    // Perform check-in
    dayPass.checkInTime = new Date();
    dayPass.status = "checked_in";
    await dayPass.save();

    res.json({
      message: "Check-in successful",
      dayPass,
      checkInTime: dayPass.checkInTime,
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("checkInWithQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Check-out with QR code
export const checkOutWithQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    if (dayPass.status !== "checked_in") {
      return res.status(400).json({
        error: `Cannot check-out. Pass status: ${dayPass.status}`
      });
    }

    // Perform check-out
    dayPass.checkOutTime = new Date();
    dayPass.status = "checked_out";
    await dayPass.save();

    // Calculate duration
    const duration = Math.round((dayPass.checkOutTime - dayPass.checkInTime) / (1000 * 60)); // minutes

    res.json({
      message: "Check-out successful",
      dayPass,
      checkOutTime: dayPass.checkOutTime,
      duration: `${duration} minutes`,
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("checkOutWithQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Scan QR (auto check-in or check-out based on current status)
export const scanQR = async (req, res) => {
  try {
    const { qrCode, buildingId } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code is required" });
    }

    const dayPass = await DayPass.findOne({ qrCode })
      .populate('customer', 'name email phone')
      .populate('building', 'name address');

    if (!dayPass) {
      return res.status(404).json({ error: "Invalid QR code" });
    }

    // Verify building if provided
    if (buildingId && String(dayPass.building._id) !== String(buildingId)) {
      return res.status(400).json({ error: "QR code not valid for this building" });
    }

    // Check if pass is valid for today
    const today = new Date();
    const passDate = new Date(dayPass.date);

    if (passDate.toDateString() !== today.toDateString()) {
      return res.status(400).json({ error: "Day pass is not valid for today" });
    }

    let action = "";
    let timestamp = null;

    // Auto-determine action based on current status
    if (dayPass.status === "invited") {
      // Check-in
      dayPass.checkInTime = new Date();
      dayPass.status = "checked_in";
      action = "check_in";
      timestamp = dayPass.checkInTime;
    } else if (dayPass.status === "checked_in") {
      // Check-out
      dayPass.checkOutTime = new Date();
      dayPass.status = "checked_out";
      action = "check_out";
      timestamp = dayPass.checkOutTime;
    } else {
      return res.status(400).json({
        error: `Cannot process scan. Pass status: ${dayPass.status}`
      });
    }

    await dayPass.save();

    // Calculate duration if checking out
    let duration = null;
    if (action === "check_out" && dayPass.checkInTime) {
      duration = Math.round((dayPass.checkOutTime - dayPass.checkInTime) / (1000 * 60)); // minutes
    }

    res.json({
      message: `${action.replace('_', '-')} successful`,
      action,
      dayPass,
      timestamp,
      ...(duration && { duration: `${duration} minutes` }),
      visitor: {
        name: dayPass.visitorName,
        phone: dayPass.visitorPhone,
        email: dayPass.visitorEmail
      }
    });

  } catch (error) {
    console.error("scanQR error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get user's day passes
export const getUserDayPasses = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, buildingId, page = 1, limit = 10 } = req.query;

    const query = { customer: customerId };
    if (status) query.status = status;
    if (buildingId) query.building = buildingId;

    const skip = (page - 1) * limit;

    const dayPasses = await DayPass.find(query)
      .populate('customer', 'name email phone')
      .populate('building', 'name address creditValue')
      .populate('bundle', 'no_of_dayPasses remainingPasses')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DayPass.countDocuments(query);

    res.json({
      dayPasses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + dayPasses.length < total
      }
    });

  } catch (error) {
    console.error("getUserDayPasses error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get day pass details
export const getDayPassDetails = async (req, res) => {
  try {
    const { dayPassId } = req.params;

    const dayPass = await DayPass.findById(dayPassId)
      .populate('customer', 'name email phone')
      .populate('building', 'name address openSpacePricing creditValue')
      .populate('bundle', 'no_of_dayPasses remainingPasses validUntil')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .populate('payment', 'amount method status');

    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    res.json({
      dayPass,
      canInvite: dayPass.status === "pending",
      canCheckIn: dayPass.status === "invited" && dayPass.date &&
        new Date(dayPass.date).toDateString() === new Date().toDateString(),
      canCheckOut: dayPass.status === "checked_in"
    });

  } catch (error) {
    console.error("getDayPassDetails error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Admin: Get all day passes
export const getAllDayPasses = async (req, res) => {
  try {
    const {
      status,
      buildingId,
      customerId,
      bundleId,
      date,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (buildingId) query.building = buildingId;
    if (customerId) query.customer = customerId;
    if (bundleId) query.bundle = bundleId;
    if (date) {
      const queryDate = new Date(date);
      const startOfDay = new Date(queryDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(queryDate);
      endOfDay.setHours(23, 59, 59, 999);
      query.date = { $gte: startOfDay, $lte: endOfDay };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const dayPassDocs = await DayPass.find(query)
      .populate('customer', 'name email phone mobile contactNumber contact contactNo')
      .populate('building', 'name address creditValue')
      .populate('bundle', 'no_of_dayPasses')
      .populate('invoice', 'invoiceNumber totalAmount status')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Helper: stringify ObjectId-like values (handles lean ObjectId, buffer shape, etc.)
    const toIdString = (val) => {
      try {
        if (!val) return null;
        if (typeof val === 'string') return val;
        if (typeof val === 'object') {
          if (typeof val.toHexString === 'function') return val.toHexString();
          if (typeof val.toString === 'function') {
            const s = val.toString();
            if (/^[a-f0-9]{24}$/i.test(s)) return s;
          }
          if (val.id && Buffer.isBuffer(val.id)) return val.id.toString('hex');
          if (val.buffer && Array.isArray(val.buffer.data)) return Buffer.from(val.buffer.data).toString('hex');
        }
      } catch (_) { }
      return null;
    };

    // Resolve customer when populate didn't work (no ref on DayPass.customer)
    const unresolvedIds = new Set();
    for (const dp of dayPassDocs || []) {
      const idStr = toIdString(dp.customer);
      if (idStr) unresolvedIds.add(idStr);
    }

    const idArr = Array.from(unresolvedIds);
    const [guestDocs, memberDocs, clientDocs] = await Promise.all([
      idArr.length ? Guest.find({ _id: { $in: idArr } }).select('name email phone').lean() : Promise.resolve([]),
      idArr.length ? Member.find({ _id: { $in: idArr } }).select('firstName lastName email phone').lean() : Promise.resolve([]),
      idArr.length ? Client.find({ _id: { $in: idArr } }).select('name companyName legalName contactPerson email phone contactNumber mobile contact contactNo').lean() : Promise.resolve([]),
    ]);

    const byId = new Map();
    const addDocs = (docs) => {
      for (const d of docs || []) {
        const name = d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.companyName || d.legalName || d.contactPerson || undefined;
        const phone = d.phone || d.mobile || d.contactNumber || d.contactNo || d.contact || undefined;
        byId.set(String(d._id), { _id: d._id, ...(name ? { name } : {}), ...(d.email ? { email: d.email } : {}), ...(phone ? { phone } : {}) });
      }
    };
    addDocs(guestDocs);
    addDocs(memberDocs);
    addDocs(clientDocs);

    // Normalize to ensure customer.phone is always present for frontend usage
    const dayPasses = (dayPassDocs || []).map((dp) => {
      try {
        const c = dp.customer;
        let normalized = null;
        const idStr = toIdString(c);
        if (idStr) {
          normalized = byId.get(idStr) || { _id: idStr };
        } else if (c && typeof c === 'object') {
          normalized = { ...c };
        } else {
          normalized = {};
        }
        if (!normalized.phone) {
          const fallbackPhone = normalized.mobile || normalized.contactNumber || normalized.contactNo || normalized.contact || dp?.visitorPhone || null;
          if (fallbackPhone) normalized.phone = fallbackPhone;
        }
        dp.customer = normalized;
      } catch (_) { }
      return dp;
    });

    const total = await DayPass.countDocuments(query);

    res.json({
      dayPasses,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        hasMore: skip + dayPasses.length < total
      }
    });

  } catch (err) {
    console.error("getAllDayPasses error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Update visitor draft details for "other" bookings
export const updateVisitorDraft = async (req, res) => {
  try {
    const { dayPassId } = req.params;
    const { name, phone, email, company, purpose } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Visitor name is required" });
    }

    const dayPass = await DayPass.findById(dayPassId);
    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    if (dayPass.bookingFor !== "other") {
      return res.status(400).json({ error: "Can only update visitor details for 'other' bookings" });
    }

    // Update visitor draft details
    dayPass.visitorDetailsDraft = {
      name: name?.trim(),
      phone: phone?.trim(),
      email: email?.trim(),
      company: company?.trim(),
      purpose: purpose?.trim()
    };

    await dayPass.save();

    res.json({
      success: true,
      message: "Visitor details updated successfully",
      dayPass: {
        _id: dayPass._id,
        bookingFor: dayPass.bookingFor,
        visitDate: dayPass.visitDate,
        status: dayPass.status,
        visitorDetailsDraft: dayPass.visitorDetailsDraft
      }
    });

  } catch (error) {
    console.error("updateVisitorDraft error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Manual issuance of day pass (minimal implementation)
export const issueDayPassManual = async (req, res) => {
  try {
    const { dayPassId } = req.params;

    const dayPass = await DayPass.findById(dayPassId);
    if (!dayPass) return res.status(404).json({ error: 'Day pass not found' });

    if (!['pending', 'payment_pending'].includes(dayPass.status)) {
      return res.status(400).json({ error: `Cannot issue in current status: ${dayPass.status}` });
    }

    dayPass.status = 'issued';
    await dayPass.save();

    return res.json({ success: true, message: 'Day pass issued', dayPass });
  } catch (error) {
    console.error('issueDayPassManual error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Cancel day pass booking
export const cancelDayPass = async (req, res) => {
  try {
    const { id } = req.params;
    const pass = await DayPass.findById(id).populate('building');

    if (!pass) return res.status(404).json({ success: false, message: 'Invalid Booking ID' });
    if (pass.status === 'cancelled') {
      return res.status(409).json({ success: false, message: 'Booking Already Cancelled' });
    }

    const now = toIST(new Date());
    const createdAt = toIST(pass.createdAt || pass.date);
    const building = pass.building;

    // Cancellation window logic (grace period and cutoff)
    const graceMinutes = typeof building?.meetingCancellationGraceMinutes === 'number'
      ? building.meetingCancellationGraceMinutes
      : parseInt(process.env.BOOKING_CANCELLATION_GRACE_MINUTES || '5', 10);

    const cutoffMinutes = typeof building?.meetingCancellationCutoffMinutes === 'number'
      ? building.meetingCancellationCutoffMinutes
      : parseInt(process.env.BOOKING_CANCELLATION_CUTOFF_MINUTES || '60', 10);

    const withinGrace = (now.getTime() - createdAt.getTime()) <= graceMinutes * 60 * 1000;

    // Determine the effective start time on the pass date using building openingTime
    const baseDate = startOfDayIST(pass.date || now);
    const [hh, mm] = String(building?.openingTime || '09:00').split(':').map(Number);
    const startTime = new Date(baseDate);
    startTime.setHours(hh || 9, mm || 0, 0, 0);
    const cutoffTime = new Date(startTime.getTime() - cutoffMinutes * 60 * 1000);
    const beforeCutoff = now.getTime() < cutoffTime.getTime();

    if (!(withinGrace || beforeCutoff)) {
      return res.status(403).json({ success: false, message: 'Outside Booking Cancellation Window' });
    }

    pass.status = 'cancelled';
    await pass.save();

    // Record cancellation snapshot
    try {
      const reason = req.body?.reason || req.query?.reason;
      await recordCancellation(pass, {
        cancelledBy: req.user?.roleName || 'user',
        cancellationReason: reason
      });
    } catch (e) {
      console.error('Failed to record cancelled daypass snapshot:', e?.message);
    }

    // Rollback building-level capacity
    try {
      const d = startOfDayIST(pass.date);
      await DayPassDailyUsage.updateOne(
        { building: pass.building?._id || pass.building, date: d },
        { $inc: { bookedCount: -1 } }
      );
    } catch (_) { }

    return res.json({
      success: true,
      message: 'Booking Cancelled Successfully',
      data: { booking_id: String(pass._id), status: 'cancelled' }
    });
  } catch (e) {
    console.error('cancelDayPass error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Availability endpoint
export const getAvailability = async (req, res) => {
  try {
    const { buildingId, date } = req.query;
    if (!buildingId || !date) {
      return res.status(400).json({ error: 'buildingId and date are required' });
    }
    const building = await Building.findById(buildingId);
    if (!building) return res.status(404).json({ error: 'Building not found' });
    const cap = Number(building.dayPassDailyCapacity || 0);
    const booked = await getDailyUsageCount(buildingId, date);
    const remaining = cap > 0 ? Math.max(0, cap - booked) : null;
    return res.json({ success: true, data: { capacity: cap || null, booked, remaining } });
  } catch (e) {
    console.error('getAvailability error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Manually trigger building access provisioning
export const provisionAccess = async (req, res) => {
  try {
    const { dayPassId } = req.params;
    const { provisionAccessForDayPass } = await import("../services/dayPassIssuanceService.js");

    const dayPass = await DayPass.findById(dayPassId);
    if (!dayPass) {
      return res.status(404).json({ error: "Day pass not found" });
    }

    // Call the central provisioning service
    await provisionAccessForDayPass(dayPass);

    return res.json({
      success: true,
      message: "Building access provisioning triggered successfully",
      buildingAccess: dayPass.buildingAccess
    });
  } catch (error) {
    console.error("provisionAccess error:", error);
    return res.status(500).json({
      error: "Failed to provision building access",
      message: error.message
    });
  }
};