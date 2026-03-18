import Visitor from "../models/visitorModel.js";
import Member from "../models/memberModel.js";
import User from "../models/userModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import QRCode from "qrcode";
import imagekit from "../utils/imageKit.js";
import path from "path";
import { sendNotification } from "../utils/notificationHelper.js";

const createAuditLog = async (visitorId, action, oldStatus, newStatus, userId, notes = '') => {
  console.log(`AUDIT: Visitor ${visitorId} - ${action} - ${oldStatus} → ${newStatus} by ${userId} - ${notes}`);
};

const generateQRToken = () => {
  return crypto.randomBytes(16).toString('hex');
};

async function sendInvitationEmail({ to, visitor, hostMember, qrUrl, qrToken }) {
  if (!to) return;
  const visitDate = visitor?.expectedVisitDate ? new Date(visitor.expectedVisitDate).toLocaleDateString() : 'your scheduled date';
  const hostName = hostMember ? `${hostMember.firstName || ''} ${hostMember.lastName || ''}`.trim() : 'your host';
  const subject = `Your visit invitation to Ofis Square – ${visitDate}`;

  const text = `Hello ${visitor?.name || ''},\n\n` +
    `You have been invited to visit Ofis Square by ${hostName}.\n` +
    (visitor?.purpose ? `Purpose: ${visitor.purpose}\n` : '') +
    `Date: ${visitDate}\n` +
    (visitor?.expectedArrivalTime ? `Expected Arrival: ${new Date(visitor.expectedArrivalTime).toLocaleTimeString()}\n` : '') +
    (visitor?.building?.name ? `Building: ${visitor.building.name}\n` : '') +
    `\nQuick Check-in:\nShow the attached QR at reception to check in quickly.\n` +
    `You can also tap this link to open check-in: ${qrUrl}\n\n` +
    `Thank you!`;

  let qrPngBuffer = null;
  try {
    qrPngBuffer = await QRCode.toBuffer(qrToken, { type: 'png', width: 360, margin: 1, errorCorrectionLevel: 'M' });
  } catch (e) {
    console.error('[sendInvitationEmail] QR generation failed:', e?.message || e);
  }

  const html = `<!DOCTYPE html>
  <html><head><meta charset="UTF-8" /><title>Visit Invitation</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;margin:0;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;overflow:hidden;">
      <div style="padding:20px 24px;border-bottom:1px solid #eee;">
        <h2 style="margin:0;font-size:20px;color:#111;">Visit Invitation</h2>
      </div>
      <div style="padding:20px 24px;">
        <p style="margin:0 0 12px;color:#333;">Hello <strong>${visitor?.name || ''}</strong>,</p>
        <p style="margin:0 0 12px;color:#333;">You have been invited to visit <strong>Ofis Square</strong> by <strong>${hostName}</strong>.</p>
        ${visitor?.purpose ? `<p style=\"margin:0 0 8px;color:#333;\"><strong>Purpose:</strong> ${visitor.purpose}</p>` : ''}
        <p style="margin:0 0 8px;color:#333;"><strong>Date:</strong> ${visitDate}</p>
        ${visitor?.expectedArrivalTime ? `<p style=\"margin:0 0 8px;color:#333;\"><strong>Expected Arrival:</strong> ${new Date(visitor.expectedArrivalTime).toLocaleTimeString()}</p>` : ''}
        ${visitor?.building?.name ? `<p style=\"margin:0 0 8px;color:#333;\"><strong>Building:</strong> ${visitor.building.name}</p>` : ''}
        <div style="height:12px"></div>
        <p style="margin:0 0 10px;color:#333;">Your QR for quick check-in:</p>
        ${qrPngBuffer ? `<div style=\"margin:8px 0 16px;\"><img src=\"cid:visitor-qr\" alt=\"Visitor QR\" width=\"240\" height=\"240\" style=\"display:block;border:1px solid #e5e7eb;border-radius:6px;\" /></div>` : ''}
        <p style="margin:0 0 12px;color:#333;">Or click the button to open the check-in link:</p>
        <p style="margin:0 0 16px;"><a href="${qrUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">Open Check-in Link</a></p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #eee;color:#777;font-size:12px;">This is an automated email. Please do not reply.</div>
    </div>
  </body></html>`;

  try {
    await sendNotification({
      to: { email: to },
      channels: { email: true, sms: false },
      content: {
        emailSubject: subject,
        emailHtml: html,
        emailText: text
      },
      title: 'Visit Invitation',
      attachments: qrPngBuffer ? [
        {
          filename: 'visitor-qr.png',
          content: qrPngBuffer,
          cid: 'visitor-qr',
          contentType: 'image/png',
          contentDisposition: 'inline',
        }
      ] : [],
      source: 'visitor_system',
      type: 'transactional'
    });
  } catch (err) {
    console.error('[sendInvitationEmail] Failed to send email via notification helper:', err?.message || err);
  }
}

async function sendHostNotificationEmail({ to, visitor, hostMember }) {
  if (!to) return;

  try {
    await sendNotification({
      to: { email: to, memberId: hostMember?._id },
      channels: { email: true, sms: false },
      templateKey: 'guest_arrival',
      templateVariables: {
        guestName: visitor?.name || 'Visitor',
        memberName: hostMember ? `${hostMember.firstName || ''} ${hostMember.lastName || ''}`.trim() : 'Member',
        companyName: visitor?.companyName || 'N/A'
      },
      title: 'Visitor Waiting Notification',
      source: 'visitor_system',
      type: 'transactional'
    });
  } catch (err) {
    console.error('[sendHostNotificationEmail] Failed via notification helper:', err?.message || err);
  }
}

export const requestCheckin = async (req, res) => {
  try {
    const { id } = req.params;

    const visitor = await Visitor.findById(id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    if (visitor.status !== "invited") {
      return res.status(400).json({
        success: false,
        message: `Cannot request check-in from status: ${visitor.status}`
      });
    }

    visitor.status = "pending_checkin";
    visitor.checkinRequestedAt = new Date();
    await visitor.save();

    await createAuditLog(visitor._id, "CHECKIN_REQUESTED", "invited", "pending_checkin", null, "Visitor requested check-in");

    res.json({
      success: true,
      message: "Check-in request submitted successfully",
      data: visitor
    });

  } catch (error) {
    console.error("Request check-in error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const requestCheckinNew = async (req, res) => {
  try {
    // Accept both kiosk payload and admin payload
    const body = req.body || {};

    const name = body.name?.trim();
    const email = body.email?.trim();
    const phone = body.phone?.trim();
    const companyName = body.companyName?.trim?.() || body.company?.trim?.();

    // Support hostId (kiosk) as alias for hostMemberId
    const hostMemberId = body.hostMemberId || body.hostId;

    const purpose = body.purpose?.trim?.();
    const numberOfGuests = Number(body.numberOfGuests) || 1;

    // expectedVisitDate is optional for kiosk; default to today
    let expectedVisitDate = body.expectedVisitDate ? new Date(body.expectedVisitDate) : new Date();
    // expectedArrivalTime defaults to now for kiosk
    const expectedArrivalTime = body.expectedArrivalTime ? new Date(body.expectedArrivalTime) : new Date();
    const expectedDepartureTime = body.expectedDepartureTime ? new Date(body.expectedDepartureTime) : null;

    const building = body.building;

    // Notes: append gender if provided by kiosk
    const baseNotes = body.notes?.trim?.();
    const genderNote = body.gender ? `Gender: ${body.gender}` : null;
    const notes = [baseNotes, genderNote].filter(Boolean).join(" | ") || undefined;

    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    let hostMemberDoc = null;
    if (hostMemberId) {
      hostMemberDoc = await Member.findById(hostMemberId);
      if (!hostMemberDoc) {
        return res.status(400).json({ success: false, message: 'Invalid hostMemberId' });
      }
    }
    if (building) {
      buildingDoc = await Building.findById(building);
      if (!buildingDoc) {
        return res.status(400).json({ success: false, message: 'Invalid building id' });
      }
    }

    // Duplicate check: Same phone/email, same building, same day, active status
    const startOfDay = new Date(expectedVisitDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(expectedVisitDate);
    endOfDay.setHours(23, 59, 59, 999);

    const duplicateQuery = {
      building: building || undefined,
      expectedVisitDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending_checkin', 'pending_host_approval', 'checked_in', 'invited', 'approved'] },
      deletedAt: null,
      $or: []
    };

    if (phone) duplicateQuery.$or.push({ phone });
    if (email) duplicateQuery.$or.push({ email });

    if (duplicateQuery.$or.length > 0) {
      const existingVisitor = await Visitor.findOne(duplicateQuery);
      if (existingVisitor) {
        return res.status(409).json({
          success: false,
          message: 'Visitor already has an active check-in or invitation for today',
          data: existingVisitor
        });
      }
    }

    const visitorData = {
      name,
      email,
      phone,
      companyName,
      hostMember: hostMemberId || undefined,
      purpose,
      numberOfGuests,
      expectedVisitDate,
      expectedArrivalTime,
      expectedDepartureTime,
      building: building || undefined,
      notes,
      status: 'pending_checkin',
      checkinRequestedAt: new Date(),
      // Allow kiosk to send staff user id explicitly
      createdBy: body.createdBy || req.user?.id || null
    };

    // Handle profile picture upload (kiosk sends as `profile_picture`)
    if (req.file) {
      try {
        const result = await imagekit.upload({
          file: req.file.buffer,
          fileName: `visitor-profile-${Date.now()}${path.extname(req.file.originalname)}`,
          folder: '/visitor-profiles'
        });
        visitorData.profile_picture = result.url;
      } catch (uploadError) {
        console.error('ImageKit upload error for visitor:', uploadError);
      }
    }

    const visitor = await Visitor.create(visitorData);

    await createAuditLog(visitor._id, 'CHECKIN_REQUESTED', 'invited', 'pending_checkin', req.user?.id, 'New visitor requested check-in');
    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'building', select: 'name address' }
    ]);

    // Notify host member via email
    try {
      const hostEmail = visitor?.hostMember?.email;
      if (hostEmail) {
        await sendHostNotificationEmail({ to: hostEmail, visitor, hostMember: visitor.hostMember });
      }
    } catch (e) {
      console.warn('[requestCheckinNew] Host email notify failed', e?.message || e);
    }

    // Notify visitor about check-in confirmation
    try {
      if (visitor.email) {
        await sendNotification({
          to: { email: visitor.email },
          channels: { email: true, sms: false },
          templateKey: 'visitor_checkin_confirmation',
          templateVariables: {
            greeting: 'Ofis Square',
            visitorName: visitor.name,
            memberName: `${visitor.hostMember?.firstName || ''} ${visitor.hostMember?.lastName || ''}`.trim() || 'Member',
            buildingName: visitor.building?.name || 'Ofis Square',
            purpose: visitor.purpose || 'Visit',
            arrivalTime: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          },
          title: 'Visit Confirmation',
          metadata: {
            category: 'visitor',
            tags: ['visitor_checkin_confirmation'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (e) {
      console.warn('[requestCheckinNew] Visitor email notify failed', e?.message || e);
    }

    return res.json({ success: true, message: 'Check-in request created', data: visitor });
  } catch (error) {
    console.error('requestCheckinNew error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveCheckin = async (req, res) => {
  try {
    const { id } = req.params;

    const visitor = await Visitor.findById(id).populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'building', select: 'name address' }
    ]);

    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    if (visitor.status !== "pending_checkin") {
      return res.status(400).json({
        success: false,
        message: `Cannot approve from status: ${visitor.status}`
      });
    }

    visitor.status = "invited";
    visitor.approvedBy = req.user?.id;
    visitor.approvedAt = new Date();
    const qrToken = generateQRToken();
    visitor.qrToken = qrToken;
    visitor.qrExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await visitor.save();

    const qrUrl = `${req.protocol}://${req.get('host')}/api/visitors/scan?token=${qrToken}`;

    await createAuditLog(visitor._id, "CHECKIN_APPROVED", "pending_checkin", "approved", req.user?.id, "Check-in request approved");

    if (visitor.email) {
      try {
        await sendInvitationEmail({
          to: visitor.email,
          visitor,
          hostMember: visitor.hostMember,
          qrUrl,
          qrToken,
        });
      } catch (e) {
        console.error('[approveCheckin] Email send failed:', e?.message || e);
      }
    }

    res.json({
      success: true,
      message: "Check-in request approved successfully",
      data: {
        visitor,
        qrToken,
        qrUrl
      }
    });

  } catch (error) {
    console.error("Approve check-in error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPendingCheckinRequests = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const visitors = await Visitor.find({
      status: "pending_checkin",
      deletedAt: null
    })
      .populate('hostMember', 'firstName lastName email phone')
      .populate('building', 'name address')
      // .populate('createdBy', 'name email')
      .sort({ checkinRequestedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Visitor.countDocuments({
      status: "pending_checkin",
      deletedAt: null
    });

    res.json({
      success: true,
      data: visitors,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get pending check-in requests error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createVisitor = async (req, res) => {
  try {
    let {
      name,
      email,
      phone,
      companyName,
      hostMemberId,
      purpose,
      numberOfGuests = 1,
      expectedVisitDate,
      expectedArrivalTime,
      expectedDepartureTime,
      building,
      notes
    } = req.body;

    // If a member or client is logged in, use their context for host and building
    if (req.user?.memberId) {
      hostMemberId = req.user.memberId;
    }

    if (req.user?.clientId) {
      const clientDoc = await Client.findById(req.user.clientId);
      if (clientDoc?.building) {
        building = clientDoc.building;
      }
    }

    const errors = {};
    if (!name?.trim()) {
      errors.name = "Name is required";
    }
    if (!expectedVisitDate) {
      errors.expectedVisitDate = "Expected visit date is required";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors
      });
    }

    let hostMember = null;
    if (hostMemberId) {
      hostMember = await Member.findById(hostMemberId);
      if (!hostMember) {
        return res.status(404).json({ success: false, message: "Host member not found" });
      }
    }

    if (building) {
      const buildingDoc = await Building.findById(building);
      if (!buildingDoc) {
        return res.status(404).json({ success: false, message: "Building not found" });
      }
    }

    // Duplicate check: Same phone/email, same building, same day, active status
    const startOfDay = new Date(expectedVisitDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(expectedVisitDate);
    endOfDay.setHours(23, 59, 59, 999);

    const duplicateQuery = {
      building: building || undefined,
      expectedVisitDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending_checkin', 'pending_host_approval', 'checked_in', 'invited', 'approved'] },
      deletedAt: null,
      $or: []
    };

    if (phone?.trim()) duplicateQuery.$or.push({ phone: phone.trim() });
    if (email?.trim()) duplicateQuery.$or.push({ email: email.trim() });

    if (duplicateQuery.$or.length > 0) {
      const existingVisitor = await Visitor.findOne(duplicateQuery);
      if (existingVisitor) {
        return res.status(409).json({
          success: false,
          message: 'Visitor already has an active check-in or invitation for today',
          data: existingVisitor
        });
      }
    }

    const visitorData = {
      name: name.trim(),
      email: email?.trim(),
      phone: phone?.trim(),
      companyName: companyName?.trim(),
      hostMember: hostMemberId || undefined,
      purpose: purpose?.trim(),
      numberOfGuests: Math.max(1, parseInt(numberOfGuests) || 1),
      expectedVisitDate: new Date(expectedVisitDate),
      expectedArrivalTime: expectedArrivalTime ? new Date(expectedArrivalTime) : null,
      expectedDepartureTime: expectedDepartureTime ? new Date(expectedDepartureTime) : null,
      building,
      notes: notes?.trim(),
      createdBy: req.user?.id,
      status: "invited"
    };

    // Handle profile picture upload
    if (req.file) {
      try {
        const result = await imagekit.upload({
          file: req.file.buffer,
          fileName: `visitor-profile-${Date.now()}${path.extname(req.file.originalname)}`,
          folder: '/visitor-profiles'
        });
        visitorData.profile_picture = result.url;
      } catch (uploadError) {
        console.error('ImageKit upload error for visitor:', uploadError);
      }
    }

    // Create visitor
    const visitor = await Visitor.create(visitorData);

    const qrToken = generateQRToken(visitor._id, visitor.expectedVisitDate);
    const qrUrl = `${req.protocol}://${req.get('host')}/api/visitors/scan?token=${qrToken}`;

    await createAuditLog(visitor._id, "CREATED", null, "invited", req.user?.id, "Visitor invitation created");
    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone client', populate: { path: 'client', select: 'companyName' } },
      { path: 'building', select: 'name address' }
    ]);

    // Notify host about scheduled visit
    try {
      const hostEmail = visitor.hostMember?.email;
      if (hostEmail) {
        await sendNotification({
          to: { email: hostEmail, memberId: visitor.hostMember?._id },
          channels: { email: true, sms: true },
          templateKey: 'visitor_scheduled_notify_host',
          templateVariables: {
            greeting: visitor.hostMember?.client?.companyName || 'Ofis Square',
            memberName: `${visitor.hostMember?.firstName || ''} ${visitor.hostMember?.lastName || ''}`.trim() || 'Member',
            visitorName: visitor.name,
            visitorCompany: visitor.companyName || 'N/A',
            purpose: visitor.purpose || 'Visit',
            buildingName: visitor.building?.name || 'Ofis Square',
            visitDate: new Date(visitor.expectedVisitDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
            visitTime: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'N/A'
          },
          title: 'Visitor Scheduled',
          metadata: {
            category: 'visitor',
            tags: ['visitor_scheduled_notify_host'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (hostNotifyErr) {
      console.warn('createVisitor: failed to send visitor_scheduled_notify_host:', hostNotifyErr?.message || hostNotifyErr);
    }

    if (visitor?.email) {
      try {
        await sendInvitationEmail({
          to: visitor.email,
          visitor,
          hostMember: visitor.hostMember,
          qrUrl,
          qrToken,
        });

        // Also send the new confirmation notification as requested
        await sendNotification({
          to: { email: visitor.email },
          channels: { email: true, sms: false },
          templateKey: 'visitor_checkin_confirmation',
          templateVariables: {
            greeting: "Ofis Square",
            visitorName: visitor.name,
            memberName: `${visitor.hostMember?.firstName || ''} ${visitor.hostMember?.lastName || ''}`.trim() || 'Member',
            buildingName: visitor.building?.name || 'Ofis Square',
            purpose: visitor.purpose || 'Visit',
            arrivalTime: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          },
          title: 'Visit Confirmation',
          metadata: {
            category: 'visitor',
            tags: ['visitor_checkin_confirmation'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });

      } catch (e) {
        console.error('[createVisitor] Email send failed:', e?.message || e);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        visitor,
        qrToken,
        qrUrl
      }
    });

  } catch (error) {
    console.error("Create visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVisitors = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      hostMember,
      building,
      date,
      startDate,
      endDate,
      search
    } = req.query;

    const filters = { deletedAt: null };
    if (status) {
      if (Array.isArray(status)) {
        filters.status = { $in: status };
      } else {
        filters.status = status;
      }
    }

    if (hostMember) {
      filters.hostMember = hostMember;
    }
    if (building) {
      filters.building = building;
    }
    if (date) {
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      filters.expectedVisitDate = { $gte: startOfDay, $lte: endOfDay };
    } else if (startDate || endDate) {
      filters.expectedVisitDate = {};
      if (startDate) {
        filters.expectedVisitDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filters.expectedVisitDate.$lte = end;
      }
    }
    if (search?.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filters.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { companyName: searchRegex },
        { purpose: searchRegex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [visitors, totalCount] = await Promise.all([
      Visitor.find(filters)
        .populate('hostMember', 'firstName lastName email phone')
        .populate('building', 'name address')
        .populate('processedByCheckin', 'firstName lastName')
        .populate('processedByCheckout', 'firstName lastName')
        .sort({ expectedVisitDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Visitor.countDocuments(filters)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: visitors,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: totalCount,
        hasMore: parseInt(page) < totalPages,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error("Get visitors error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTodaysVisitors = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const visitors = await Visitor.findTodaysVisitors(targetDate);

    res.json({
      success: true,
      data: visitors,
      meta: {
        date: targetDate.toISOString().split('T')[0],
        total: visitors.length,
        invited: visitors.filter(v => v.status === 'invited').length,
        checkedIn: visitors.filter(v => v.status === 'checked_in').length
      }
    });

  } catch (error) {
    console.error("Get today's visitors error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVisitorById = async (req, res) => {
  try {
    const { id } = req.params;
    // Validate ObjectId format to avoid CastError when non-id paths (e.g., 'scan') hit this route
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid visitor ID format" });
    }

    const visitor = await Visitor.findOne({ _id: id, deletedAt: null })
      .populate('hostMember', 'firstName lastName email phone')
      .populate('building', 'name address')
      .populate('processedByCheckin', 'firstName lastName')
      .populate('processedByCheckout', 'firstName lastName')
      .populate('createdBy', 'firstName lastName');

    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    res.json({ success: true, data: visitor });

  } catch (error) {
    console.error("Get visitor by ID error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const checkinVisitor = async (req, res) => {
  try {
    const { id } = req.params;
    const { badgeId, checkInTime, notes } = req.body;

    const visitor = await Visitor.findOne({ _id: id, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    if (visitor.status === 'checked_in') {
      return res.status(409).json({
        success: false,
        data: visitor,
        message: "Visitor already checked in"
      });
    }

    if (!Visitor.isValidTransition(visitor.status, 'checked_in')) {
      return res.status(400).json({
        success: false,
        message: `Cannot check in visitor with status: ${visitor.status}`
      });
    }

    if (!visitor.canCheckIn()) {
      return res.status(400).json({
        success: false,
        message: "Visitor invitation has expired or is not valid for check-in"
      });
    }

    const oldStatus = visitor.status;
    const checkInTimestamp = checkInTime ? new Date(checkInTime) : new Date();

    // Change: Transition to pending_host_approval instead of checked_in
    visitor.status = 'pending_host_approval';
    visitor.checkinRequestedAt = checkInTimestamp;
    visitor.processedByCheckin = req.user?.id;

    if (badgeId?.trim()) {
      visitor.badgeId = badgeId.trim();
    }

    if (notes?.trim()) {
      visitor.notes = visitor.notes ? `${visitor.notes}\n${notes.trim()}` : notes.trim();
    }

    await visitor.save();
    await createAuditLog(visitor._id, "CHECKIN_REQUEST_START", oldStatus, "pending_host_approval", req.user?.id, notes);

    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone client', populate: { path: 'client', select: 'companyName' } },
      { path: 'building', select: 'name address' }
    ]);

    // Send Notification to Host (Standardized)
    try {
      const hostMemberId = visitor.hostMember?._id;
      if (hostMemberId) {
        await sendNotification({
          to: { memberId: hostMemberId },
          channels: { push: true, inApp: true, sms: false, email: true },
          templateKey: 'visitor_checkin_request',
          templateVariables: {
            visitorName: visitor.name,
            memberName: visitor.hostMember?.firstName || 'Member',
            buildingName: visitor.building?.name || 'Ofis Square',
            companyName: visitor.companyName || 'N/A'
          },
          title: 'Visitor Alert',
          metadata: {
            category: 'visitor',
            tags: ['visitor_checkin_request'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (noteErr) {
      console.warn('checkinVisitor: failed to send visitor_checkin_request notification:', noteErr?.message || noteErr);
    }

    // Notify host about guest arrival
    try {
      const hostEmail = visitor.hostMember?.email;
      if (hostEmail) {
        await sendNotification({
          to: { email: hostEmail, memberId: visitor.hostMember?._id },
          channels: { email: true, sms: false },
          templateKey: 'guest_arrival',
          templateVariables: {
            greeting: visitor.hostMember?.client?.companyName || 'Ofis Square',
            memberName: visitor.hostMember?.firstName || 'Member',
            companyName: 'Ofis Square',
            guestName: visitor.name
          },
          title: 'Guest Arrived',
          metadata: {
            category: 'visitor',
            tags: ['guest_arrival'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('checkinVisitor: failed to send guest_arrival notification:', notifyErr?.message || notifyErr);
    }

    res.json({
      success: true,
      data: visitor,
      message: "Check-in request sent to host"
    });

  } catch (error) {
    console.error("Check in visitor error:", error);
    if (error.code === 11000 && error.keyPattern?.badgeId) {
      return res.status(409).json({ success: false, message: "Badge ID already in use" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const checkoutVisitor = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkOutTime, notes } = req.body;

    const visitor = await Visitor.findOne({ _id: id, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    if (visitor.status === 'checked_out') {
      return res.json({
        success: true,
        data: visitor,
        message: "Visitor already checked out"
      });
    }

    if (!visitor.canCheckOut()) {
      return res.status(400).json({
        success: false,
        message: `Cannot check out visitor with status: ${visitor.status}`
      });
    }

    const oldStatus = visitor.status;
    const checkOutTimestamp = checkOutTime ? new Date(checkOutTime) : new Date();
    visitor.status = 'checked_out';
    visitor.checkOutTime = checkOutTimestamp;
    visitor.processedByCheckout = req.user?.id;

    if (notes?.trim()) {
      visitor.notes = visitor.notes ? `${visitor.notes}\n${notes.trim()}` : notes.trim();
    }

    await visitor.save();
    await createAuditLog(visitor._id, "CHECKOUT", oldStatus, "checked_out", req.user?.id, notes);

    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'building', select: 'name address' }
    ]);

    res.json({
      success: true,
      data: visitor,
      message: "Visitor checked out successfully"
    });

  } catch (error) {
    console.error("Check out visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const scanQRCode = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "QR token is required" });
    }

    const visitor = await Visitor.findOne({ qrToken: token, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Invalid or expired QR code" });
    }

    if (visitor.qrExpiresAt && visitor.qrExpiresAt < new Date()) {
      return res.status(401).json({ success: false, message: "QR code has expired" });
    }

    const today = new Date().toISOString().split('T')[0];
    const expectedDate = visitor.expectedVisitDate.toISOString().split('T')[0];
    if (expectedDate !== today) {
      return res.status(400).json({
        success: false,
        message: "QR code is not valid for today's visit"
      });
    }
    if (visitor.status === 'checked_in') {
      await visitor.populate([
        { path: 'hostMember', select: 'firstName lastName email phone' },
        { path: 'building', select: 'name address' }
      ]);

      return res.status(409).json({
        success: false,
        data: visitor,
        message: "Visitor already checked in"
      });
    }

    if (!visitor.canCheckIn()) {
      return res.status(400).json({
        success: false,
        message: "Visitor cannot be checked in at this time"
      });
    }

    const oldStatus = visitor.status;
    // Change: Transition to pending_host_approval instead of checked_in
    visitor.status = 'pending_host_approval';
    visitor.checkinRequestedAt = new Date();
    visitor.checkInMethod = 'qr';
    visitor.processedByCheckin = req.user?.id;

    await visitor.save();
    await createAuditLog(visitor._id, "QR_CHECKIN_REQUEST", oldStatus, "pending_host_approval", req.user?.id, "Checked in via QR scan, waiting for host approval");

    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone client', populate: { path: 'client', select: 'companyName' } },
      { path: 'building', select: 'name address' }
    ]);

    // Send Notification to Host (Standardized)
    try {
      const hostMemberId = visitor.hostMember?._id;
      if (hostMemberId) {
        await sendNotification({
          to: { memberId: hostMemberId },
          channels: { push: true, inApp: true, sms: false, email: true },
          templateKey: 'visitor_checkin_request',
          templateVariables: {
            visitorName: visitor.name,
            memberName: visitor.hostMember?.firstName || 'Member',
            buildingName: visitor.building?.name || 'Ofis Square',
            companyName: visitor.companyName || 'N/A'
          },
          title: 'Visitor Alert',
          metadata: {
            category: 'visitor',
            tags: ['visitor_checkin_request'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (noteErr) {
      console.warn('scanQRCode: failed to send visitor_checkin_request notification:', noteErr?.message || noteErr);
    }

    // Notify host about guest arrival
    try {
      const hostEmail = visitor.hostMember?.email;
      if (hostEmail) {
        await sendNotification({
          to: { email: hostEmail, memberId: visitor.hostMember?._id },
          channels: { email: true, sms: false },
          templateKey: 'guest_arrival',
          templateVariables: {
            greeting: visitor.hostMember?.client?.companyName || 'Ofis Square',
            memberName: visitor.hostMember?.firstName || 'Member',
            companyName: 'Ofis Square',
            guestName: visitor.name
          },
          title: 'Guest Arrived',
          metadata: {
            category: 'visitor',
            tags: ['guest_arrival'],
            route: `/visitors/${visitor._id}`,
            deepLink: `ofis://visitors/${visitor._id}`,
            routeParams: { id: String(visitor._id) }
          },
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('scanQRCode: failed to send guest_arrival notification:', notifyErr?.message || notifyErr);
    }

    res.json({
      success: true,
      data: visitor,
      message: "Check-in request sent to host via QR"
    });

  } catch (error) {
    console.error("QR scan error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cancelVisitor = async (req, res) => {
  try {
    const { id } = req.params;
    const { cancelReason, notes } = req.body;

    const visitor = await Visitor.findOne({ _id: id, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    // Validate transition
    if (!Visitor.isValidTransition(visitor.status, 'cancelled')) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel visitor with status: ${visitor.status}`
      });
    }

    const oldStatus = visitor.status;
    visitor.status = 'cancelled';
    visitor.cancelReason = cancelReason?.trim();

    if (notes?.trim()) {
      visitor.notes = visitor.notes ? `${visitor.notes}\n${notes.trim()}` : notes.trim();
    }

    await visitor.save();
    await createAuditLog(visitor._id, "CANCELLED", oldStatus, "cancelled", req.user?.id, cancelReason);

    res.json({
      success: true,
      data: visitor,
      message: "Visitor invitation cancelled successfully"
    });

  } catch (error) {
    console.error("Cancel visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVisitorStats = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;

    let dateFilter = { deletedAt: null };

    if (date) {
      const targetDate = new Date(date);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter.expectedVisitDate = { $gte: startOfDay, $lte: endOfDay };
    } else if (startDate || endDate) {
      dateFilter.expectedVisitDate = {};
      if (startDate) {
        dateFilter.expectedVisitDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.expectedVisitDate.$lte = end;
      }
    }

    const stats = await Visitor.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalGuests: { $sum: "$numberOfGuests" }
        }
      }
    ]);

    const result = {
      total: 0,
      totalGuests: 0,
      invited: 0,
      checked_in: 0,
      checked_out: 0,
      cancelled: 0,
      no_show: 0,
      blocked: 0
    };

    stats.forEach(stat => {
      result.total += stat.count;
      result.totalGuests += stat.totalGuests;
      result[stat._id] = stat.count;
    });

    res.json({ success: true, data: result });

  } catch (error) {
    console.error("Get visitor stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVisitor = async (req, res) => {
  try {
    const { id } = req.params;

    const visitor = await Visitor.findById(id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    visitor.deletedAt = new Date();
    visitor.deletedBy = req.user?.id;
    await visitor.save();

    await createAuditLog(visitor._id, "DELETED", visitor.status, visitor.status, req.user?.id, "Visitor deleted");

    res.json({
      success: true,
      message: "Visitor deleted successfully"
    });

  } catch (error) {
    console.error("Delete visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markNoShows = async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    const result = await Visitor.updateMany(
      {
        status: { $in: ["invited", "pending_checkin", "approved", "pending_host_approval"] },
        expectedVisitDate: { $lt: yesterday },
        deletedAt: null
      },
      {
        $set: {
          status: "no_show",
          updatedAt: new Date()
        }
      }
    );

    console.log(`[markNoShows] Updated ${result.modifiedCount} visitors to no_show status`);
    return result.modifiedCount;
  } catch (error) {
    console.error("[markNoShows] Error:", error);
    throw error;
  }
};

export const acceptVisitor = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.user?.memberId;

    if (!memberId) {
      return res.status(401).json({ success: false, message: "Member authentication required" });
    }

    const visitor = await Visitor.findOne({ _id: id, hostMember: memberId, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found or you are not the host" });
    }

    if (visitor.status !== 'pending_host_approval') {
      return res.status(400).json({ success: false, message: `Cannot accept visitor with status: ${visitor.status}` });
    }

    const oldStatus = visitor.status;
    visitor.status = 'checked_in';
    visitor.checkInTime = new Date();
    await visitor.save();

    await createAuditLog(visitor._id, "HOST_ACCEPTED", oldStatus, "checked_in", memberId, "Host accepted visitor");

    // Send Notification to Visitor
    try {
      if (visitor.phone || visitor.email) {
        await visitor.populate([
          { path: 'hostMember', select: 'firstName lastName' },
          { path: 'building', select: 'name' }
        ]);
        await sendNotification({
          to: { phone: visitor.phone, email: visitor.email },
          channels: { sms: !!visitor.phone, email: true },
          templateKey: 'visitor_accepted',
          templateVariables: {
            visitorName: visitor.name,
            hostName: `${visitor.hostMember?.firstName || ''} ${visitor.hostMember?.lastName || ''}`.trim() || 'Host',
            buildingName: visitor.building?.name || 'Ofis Square'
          },
          title: 'Visit Approved',
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('acceptVisitor: failed to send visitor_accepted notification:', notifyErr?.message || notifyErr);
    }

    res.json({ success: true, message: "Visitor accepted and checked in", data: visitor });
  } catch (error) {
    console.error("Accept visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const declineVisitor = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.user?.memberId;

    if (!memberId) {
      return res.status(401).json({ success: false, message: "Member authentication required" });
    }

    const visitor = await Visitor.findOne({ _id: id, hostMember: memberId, deletedAt: null });
    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found or you are not the host" });
    }

    if (visitor.status !== 'pending_host_approval') {
      return res.status(400).json({ success: false, message: `Cannot decline visitor with status: ${visitor.status}` });
    }

    const oldStatus = visitor.status;
    visitor.status = 'cancelled';
    visitor.cancelReason = "Declined by host";
    await visitor.save();

    await createAuditLog(visitor._id, "HOST_DECLINED", oldStatus, "cancelled", memberId, "Host declined visitor");

    // Send Notification to Visitor
    try {
      if (visitor.phone || visitor.email) {
        await visitor.populate([
          { path: 'building', select: 'name' }
        ]);
        await sendNotification({
          to: { phone: visitor.phone, email: visitor.email },
          channels: { sms: !!visitor.phone, email: false },
          templateKey: 'visitor_declined',
          templateVariables: {
            visitorName: visitor.name,
            buildingName: visitor.building?.name || 'Ofis Square',
            reason: visitor.cancelReason || 'Declined by host'
          },
          title: 'Visit Declined',
          source: 'system',
          type: 'transactional'
        });
      }
    } catch (notifyErr) {
      console.warn('declineVisitor: failed to send visitor_declined notification:', notifyErr?.message || notifyErr);
    }

    res.json({ success: true, message: "Visitor declined", data: visitor });
  } catch (error) {
    console.error("Decline visitor error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
