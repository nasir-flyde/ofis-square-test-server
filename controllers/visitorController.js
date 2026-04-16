import Visitor from "../models/visitorModel.js";
import Notification from "../models/notificationModel.js";
import Member from "../models/memberModel.js";
import User from "../models/userModel.js";
import Building from "../models/buildingModel.js";
import Client from "../models/clientModel.js";
import Guest from "../models/guestModel.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import QRCode from "qrcode";
import imagekit from "../utils/imageKit.js";
import path from "path";
import NotificationCategory from "../models/NotificationCategoryModel.js";
import { sendNotification } from "../utils/notificationHelper.js";
import Role from "../models/roleModel.js";
import { logActivity, logErrorActivity } from "../utils/activityLogger.js";

const createAuditLog = async (visitorId, action, oldStatus, newStatus, userId, notes = '') => {
  console.log(`AUDIT: Visitor ${visitorId} - ${action} - ${oldStatus} → ${newStatus} by ${userId} - ${notes}`);
};

const generateQRToken = () => {
  return crypto.randomBytes(16).toString('hex');
};

const getCommunityContact = async (buildingId) => {
  try {
    if (!buildingId) return null;
    const communityRole = await Role.findOne({ roleName: { $regex: /^community$/i } });
    if (!communityRole) return null;

    const manager = await User.findOne({
      buildingId: buildingId,
      role: communityRole._id
    }).select('name phone');

    if (manager) {
      return {
        name: manager.name,
        phone: manager.phone,
        whatsapp: manager.phone?.replace(/\D/g, '')
      };
    }
  } catch (err) {
    console.error('[getCommunityContact] lookup failed:', err);
  }
  return null;
};

async function sendInvitationEmail({ to, visitor, hostMember, hostGuest, qrUrl, qrToken }) {
  if (!to) return;
  const visitDate = visitor?.expectedVisitDate ? new Date(visitor.expectedVisitDate).toLocaleDateString() : 'your scheduled date';
  const hostName = hostMember
    ? `${hostMember.firstName || ''} ${hostMember.lastName || ''}`.trim()
    : (hostGuest?.name || 'your host');
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
    const categoryId = '69d8955c9b549289379e4710';

    await sendNotification({
      to: { email: to },
      channels: { email: true, sms: false },
      content: {
        emailSubject: subject,
        emailHtml: html,
        emailText: text
      },
      title: 'Visit Invitation',
      categoryId: categoryId,
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

async function sendHostNotificationEmail({ to, visitor, hostMember, hostGuest }) {
  if (!to) return;

  try {
    const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });

    await sendNotification({
      to: { email: to, memberId: hostMember?._id, guestId: hostGuest?._id },
      channels: { email: true, sms: false },
      templateKey: 'visitor_checkin_request',
      templateVariables: {
        visitorName: visitor?.name || 'Visitor',
        memberName: hostMember
          ? `${hostMember.firstName || ''} ${hostMember.lastName || ''}`.trim()
          : (hostGuest?.name || 'Host'),
        buildingName: visitor?.building?.name || 'Ofis Square',
        companyName: visitor?.companyName || 'N/A'
      },
      title: 'Visitor Alert',
      categoryId: visitorCategory?._id,
      metadata: {
        category: 'visitor',
        tags: ['visitor_checkin_request'],
        route: `/visitors/${visitor._id}`,
        deepLink: `ofis://visitors/${visitor._id}`,
        routeParams: { id: String(visitor._id) }
      },
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
  console.log('[requestCheckinNew] Stage 1: Function entry. Request body:', JSON.stringify(req.body, null, 2));
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

    let building = body.building;

    // Notes: append gender if provided by kiosk
    const baseNotes = body.notes?.trim?.();
    const genderNote = body.gender ? `Gender: ${body.gender.toLowerCase()}` : null;
    const notes = [baseNotes, genderNote].filter(Boolean).join(" | ") || undefined;

    console.log('[requestCheckinNew] Stage 2: Extracted fields.', { name, email, phone, hostMemberId, building });

    if (!name) {
      console.warn('[requestCheckinNew] Validation failed: Name is missing');
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    let hostMemberDoc = null;
    if (hostMemberId) {
      console.log('[requestCheckinNew] Stage 3: Looking up host member:', hostMemberId);
      hostMemberDoc = await Member.findById(hostMemberId).populate('client');
      if (!hostMemberDoc) {
        console.warn('[requestCheckinNew] Invalid hostMemberId:', hostMemberId);
        return res.status(400).json({ success: false, message: 'Invalid hostMemberId' });
      }
      console.log('[requestCheckinNew] Host member found:', hostMemberDoc.firstName, hostMemberDoc.lastName);

      // Auto-attach building from host member's client if not provided in body
      if (!building && hostMemberDoc.client?.building) {
        building = hostMemberDoc.client.building;
        console.log('[requestCheckinNew] Auto-attached building from host member:', building);
      }
    }
    if (building) {
      console.log('[requestCheckinNew] Stage 4: Validating building ID:', building);
      const buildingDoc = await Building.findById(building);
      if (!buildingDoc) {
        console.warn('[requestCheckinNew] Invalid building ID:', building);
        return res.status(400).json({ success: false, message: 'Invalid building id' });
      }
      console.log('[requestCheckinNew] Building validated:', buildingDoc.name);
    }

    // Duplicate check: Same phone/email, same building, same day, active status
    console.log('[requestCheckinNew] Stage 5: Running duplicate check');
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
      if (existingVisitor && ['invited', 'approved'].includes(existingVisitor.status)) {
        console.warn('[requestCheckinNew] Duplicate found:', existingVisitor._id);
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
      status: 'pending_host_approval',
      checkinRequestedAt: new Date(),
      // Allow kiosk to send staff user id explicitly
      createdBy: body.createdBy || req.user?.id || null
    };

    // Handle profile picture upload (kiosk sends as `profile_picture`)
    if (req.file) {
      console.log('[requestCheckinNew] Stage 6: Uploading profile picture');
      try {
        const result = await imagekit.upload({
          file: req.file.buffer,
          fileName: `visitor-profile-${Date.now()}${path.extname(req.file.originalname)}`,
          folder: '/visitor-profiles'
        });
        visitorData.profile_picture = result.url;
        console.log('[requestCheckinNew] Profile picture uploaded:', result.url);
      } catch (uploadError) {
        console.error('[requestCheckinNew] ImageKit upload error for visitor:', uploadError);
      }
    }

    console.log('[requestCheckinNew] Stage 7: Creating visitor document');
    const visitor = await Visitor.create(visitorData);
    console.log('[requestCheckinNew] Visitor created with ID:', visitor._id);

    console.log('[requestCheckinNew] Stage 8: Logging activity and audit');
    await logActivity({
      req,
      action: 'CHECK_IN',
      entity: 'Visitor',
      entityId: visitor._id,
      description: 'New visitor requested check-in'
    });

    await createAuditLog(visitor._id, 'CHECKIN_REQUESTED', 'invited', 'pending_host_approval', req.user?.id, 'New visitor requested check-in');

    console.log('[requestCheckinNew] Stage 9: Populating visitor data');
    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'hostGuest', select: 'name email phone companyName' },
      { path: 'building', select: 'name address businessMapLink' }
    ]);

    // Notify host member via email
    console.log('[requestCheckinNew] Stage 10: Notifying host');
    try {
      const hostEmail = visitor?.hostMember?.email || visitor?.hostGuest?.email;
      if (hostEmail) {
        console.log('[requestCheckinNew] Sending host notification email to:', hostEmail);
        await sendHostNotificationEmail({
          to: hostEmail,
          visitor,
          hostMember: visitor.hostMember,
          hostGuest: visitor.hostGuest
        });
        console.log('[requestCheckinNew] Host notification email sent');
      } else {
        console.log('[requestCheckinNew] No host email found for notification');
      }
    } catch (e) {
      console.warn('[requestCheckinNew] Host email notify failed', e?.message || e);
    }

    // Notify visitor about check-in confirmation
    console.log('[requestCheckinNew] Stage 11: Notifying visitor');
    try {
      if (visitor.email) {
        console.log('[requestCheckinNew] Preparing visitor notification for:', visitor.email);
        let qrPngBuffer = null;
        if (visitor.qrToken) {
          try {
            console.log('[requestCheckinNew] Generating QR buffer for visitor');
            qrPngBuffer = await QRCode.toBuffer(visitor.qrToken, { type: 'png', width: 360, margin: 1, errorCorrectionLevel: 'M' });
          } catch (e) {
            console.error('[requestCheckinNew] QR generation failed:', e);
          }
        }

        const communityContact = (await getCommunityContact(visitor.building?._id)) || {
          name: 'Community',
          phone: '+91 9999999999',
          whatsapp: '919999999999'
        };

        const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });
        console.log('[requestCheckinNew] Sending visitor confirmation notification');
        await sendNotification({
          to: { email: visitor.email },
          channels: { email: true, sms: false },
          templateKey: 'visitor_checkin_confirmation',
          bcc: 'nasir@flyde.in',
          templateVariables: {
            guest_name: visitor.name || 'Guest',
            host_name: visitor.hostMember
              ? `${visitor.hostMember.firstName || ''} ${visitor.hostMember.lastName || ''}`.trim()
              : (visitor.hostGuest?.name || 'Member'),
            client_name: visitor.hostMember?.client?.companyName || visitor.companyName || 'Ofis Square',
            location: visitor.building?.name || 'Ofis Square',
            date: visitor.expectedVisitDate ? new Date(visitor.expectedVisitDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
            time: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'N/A',
            purpose: visitor.purpose || 'Visit',
            qr_code_url: 'cid:visitor-qr',
            map_link: visitor.building?.businessMapLink || '#',
            community_name: communityContact.name,
            community_phone: communityContact.phone,
            community_whatsapp: communityContact.whatsapp,
            appstore_link: 'https://apps.apple.com/app/ofis-square/id123456789',
            playstore_link: 'https://play.google.com/store/apps/details?id=com.ofissquare'
          },
          title: 'Visit Confirmation',
          categoryId: visitorCategory?._id,
          attachments: qrPngBuffer ? [
            {
              filename: 'visitor-qr.png',
              content: qrPngBuffer,
              cid: 'visitor-qr',
              contentType: 'image/png',
              contentDisposition: 'inline',
            }
          ] : [],
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
        console.log('[requestCheckinNew] Visitor confirmation notification sent');
      } else {
        console.log('[requestCheckinNew] No visitor email found for notification');
      }
    } catch (e) {
      console.warn('[requestCheckinNew] Visitor email notify failed', e?.message || e);
    }

    console.log('[requestCheckinNew] Stage 12: Success. Returning response.');
    return res.json({ success: true, message: 'Check-in request created', data: visitor });
  } catch (error) {
    console.error('[requestCheckinNew] Error:', error);
    await logErrorActivity(req, error, 'Visitor', { function: 'requestCheckinNew' });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveCheckin = async (req, res) => {
  try {
    const { id } = req.params;

    const visitor = await Visitor.findById(id).populate([
      { path: 'hostMember', select: 'firstName lastName email phone' },
      { path: 'hostGuest', select: 'name email phone companyName' },
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
          hostGuest: visitor.hostGuest,
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
      .populate('hostGuest', 'name email phone companyName')
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
      notes,
      gender
    } = req.body;

    // If a member, client or ondemand user is logged in, use their context for host and building
    let hostGuestId = null;
    const targetMemberId = req.memberId || req.user?.memberId;
    if (targetMemberId) {
      hostMemberId = targetMemberId;
      const memberDoc = await Member.findById(targetMemberId).populate('client');
      if (memberDoc?.client?.building) {
        building = memberDoc.client.building;
      }
    }

    if (req.user?.guestId) {
      hostGuestId = req.user.guestId;
    }

    if (req.user?.clientId) {
      const clientDoc = await Client.findById(req.user.clientId);
      if (clientDoc?.building) {
        building = clientDoc.building;
      }
    }

    // Fallback building for hostGuest if not already determined
    if (hostGuestId && !building) {
      const guestDoc = await Guest.findById(hostGuestId);
      if (guestDoc?.buildingId) {
        building = guestDoc.buildingId;
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
      hostMember = await Member.findById(hostMemberId).populate('client');
      if (!hostMember) {
        return res.status(404).json({ success: false, message: "Host member not found" });
      }

      // Auto-attach building from host member's client if not provided in body
      if (!building && hostMember.client?.building) {
        building = hostMember.client.building;
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
      if (existingVisitor && ['invited', 'approved'].includes(existingVisitor.status)) {
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
      hostGuest: hostGuestId || undefined,
      purpose: purpose?.trim(),
      numberOfGuests: Math.max(1, parseInt(numberOfGuests) || 1),
      expectedVisitDate: new Date(expectedVisitDate),
      expectedArrivalTime: expectedArrivalTime ? new Date(expectedArrivalTime) : null,
      expectedDepartureTime: expectedDepartureTime ? new Date(expectedDepartureTime) : null,
      building,
      notes: [notes?.trim(), gender ? `Gender: ${gender.toLowerCase()}` : null].filter(Boolean).join(" | ") || undefined,
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

    await logActivity({
      req,
      action: 'CREATE',
      entity: 'Visitor',
      entityId: visitor._id,
      description: 'Visitor invitation created'
    });

    // Get the QR token that was generated in the pre-save hook
    const qrToken = visitor.qrToken;
    const qrUrl = `${req.protocol}://${req.get('host')}/api/visitors/scan?token=${qrToken}`;

    await createAuditLog(visitor._id, "CREATED", null, "invited", req.user?.id, "Visitor invitation created");
    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone client', populate: { path: 'client', select: 'companyName' } },
      { path: 'hostGuest', select: 'name email phone companyName' },
      { path: 'building', select: 'name address businessMapLink' }
    ]);
    try {
      const hostEmail = visitor.hostMember?.email || visitor.hostGuest?.email;
      if (hostEmail) {
        const categoryId = '69d8955c9b549289379e4710';
        const hostName = visitor.hostMember
          ? `${visitor.hostMember.firstName || ''} ${visitor.hostMember.lastName || ''}`.trim()
          : (visitor.hostGuest?.name || 'Member');

        await sendNotification({
          to: {
            email: hostEmail,
            memberId: visitor.hostMember?._id,
            guestId: visitor.hostGuest?._id
          },
          channels: { email: true, sms: true },
          templateKey: 'visitor_scheduled_notify_host',
          templateVariables: {
            greeting: visitor.hostMember?.client?.companyName || 'Ofis Square',
            memberName: hostName,
            visitorName: visitor.name,
            visitorCompany: visitor.companyName || 'N/A',
            purpose: visitor.purpose || 'Visit',
            buildingName: visitor.building?.name || 'Ofis Square',
            visitDate: new Date(visitor.expectedVisitDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
            visitTime: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'N/A'
          },
          title: 'Visitor Scheduled',
          categoryId: categoryId,
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
        let qrPngBuffer = null;
        try {
          qrPngBuffer = await QRCode.toBuffer(qrToken, { type: 'png', width: 360, margin: 1, errorCorrectionLevel: 'M' });
        } catch (e) {
          console.error('[createVisitor] QR generation failed:', e);
        }

        const communityContact = (await getCommunityContact(visitor.building?._id)) || {
          name: 'Samarth',
          phone: '+91 9999999999',
          whatsapp: '919999999999'
        };

        const categoryId = '69d8955c9b549289379e4710';
        await sendNotification({
          to: { email: visitor.email },
          channels: { email: true, sms: false },
          templateKey: 'visitor_checkin_confirmation',
          bcc: 'nasir@flyde.in',
          templateVariables: {
            guest_name: visitor.name || 'Guest',
            host_name: visitor.hostMember
              ? `${visitor.hostMember.firstName || ''} ${visitor.hostMember.lastName || ''}`.trim()
              : (visitor.hostGuest?.name || 'Member'),
            client_name: visitor.hostMember?.client?.companyName || visitor.companyName || 'Ofis Square',
            location: visitor.building?.name || 'Ofis Square',
            date: visitor.expectedVisitDate ? new Date(visitor.expectedVisitDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
            time: visitor.expectedArrivalTime ? new Date(visitor.expectedArrivalTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'N/A',
            purpose: visitor.purpose || 'Visit',
            qr_code_url: 'cid:visitor-qr',
            map_link: visitor.building?.businessMapLink || '#',
            community_name: communityContact.name,
            community_phone: communityContact.phone,
            community_whatsapp: communityContact.whatsapp,
            appstore_link: 'https://apps.apple.com/app/ofis-square/id123456789',
            playstore_link: 'https://play.google.com/store/apps/details?id=com.ofissquare'
          },
          title: 'Visit Confirmation',
          categoryId: categoryId,
          attachments: qrPngBuffer ? [
            {
              filename: 'visitor-qr.png',
              content: qrPngBuffer,
              cid: 'visitor-qr',
              contentType: 'image/png',
              contentDisposition: 'inline',
            }
          ] : [],
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
    await logErrorActivity(req, error, 'Visitor', { function: 'createVisitor' });
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
        .populate('hostGuest', 'name email phone companyName')
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
    // Extra population for hostGuest since findTodaysVisitors only populates hostMember
    if (visitors.length > 0) {
      await Visitor.populate(visitors, { path: 'hostGuest', select: 'name email phone companyName' });
    }
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
      .populate('hostGuest', 'name email phone companyName')
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
        const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });

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
          categoryId: visitorCategory?._id,
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
    const token = (req.body?.token || req.query?.token || '')?.trim();

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

    // Date check using IST (Asia/Kolkata)
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const todayStr = nowIST.toISOString().split('T')[0];

    const expectedDateIST = new Date(new Date(visitor.expectedVisitDate).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const expectedDateStr = expectedDateIST.toISOString().split('T')[0];

    if (expectedDateStr !== todayStr) {
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

    if (visitor.qrExpiresAt && visitor.qrExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Your QR code has expired. Please contact support or your host."
      });
    }

    if (!["invited", "approved", "pending_checkin"].includes(visitor.status)) {
      return res.status(400).json({
        success: false,
        message: `Visitor cannot be checked in with current status: ${visitor.status.replace(/_/g, ' ')}`
      });
    }

    if (visitor.deletedAt) {
      return res.status(400).json({
        success: false,
        message: "This visitor record has been deleted"
      });
    }

    const oldStatus = visitor.status;
    // Change: Transition to pending_host_approval instead of checked_in
    visitor.status = 'checked_in';
    visitor.checkinRequestedAt = new Date();
    visitor.checkInMethod = 'qr';
    visitor.processedByCheckin = req.user?.id;

    await visitor.save();

    await logActivity({
      req,
      action: 'CHECK_IN',
      entity: 'Visitor',
      entityId: visitor._id,
      description: 'Checked in via QR scan'
    });

    await createAuditLog(visitor._id, "QR_CHECKIN_REQUEST", oldStatus, "pending_host_approval", req.user?.id, "Checked in via QR scan, waiting for host approval");

    await visitor.populate([
      { path: 'hostMember', select: 'firstName lastName email phone client', populate: { path: 'client', select: 'companyName' } },
      { path: 'building', select: 'name address' }
    ]);

    // Send Notification to Host (Standardized)
    try {
      const hostMemberId = visitor.hostMember?._id;
      if (hostMemberId) {
        const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });
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
          categoryId: visitorCategory?._id,
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


    res.json({
      success: true,
      data: visitor,
      message: "Check-in request sent to host via QR"
    });

  } catch (error) {
    console.error("QR scan error:", error);
    await logErrorActivity(req, error, 'Visitor', { function: 'scanQRCode' });
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

    const visitorsToUpdate = await Visitor.find({
      status: { $in: ["invited", "pending_checkin", "approved", "pending_host_approval"] },
      expectedVisitDate: { $lt: yesterday },
      deletedAt: null
    }).select('_id');

    if (visitorsToUpdate.length === 0) {
      console.log(`[markNoShows] No visitors to update to no_show status`);
      return 0;
    }

    const visitorIds = visitorsToUpdate.map(v => v._id);

    const result = await Visitor.updateMany(
      { _id: { $in: visitorIds } },
      {
        $set: {
          status: "no_show",
          updatedAt: new Date()
        }
      }
    );

    // Update relevant notifications to mark action as taken
    try {
      const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });
      if (visitorCategory) {
        const stringVisitorIds = visitorIds.map(id => String(id));
        await Notification.updateMany(
          {
            categoryId: visitorCategory._id,
            'metadata.routeParams.id': { $in: stringVisitorIds },
            actionTaken: false
          },
          { $set: { actionTaken: true } }
        );
      }
    } catch (notifErr) {
      console.warn('markNoShows: failed to update notification actionTaken status:', notifErr.message);
    }

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
    const guestId = req.user?.guestId;

    if (!memberId && !guestId) {
      return res.status(401).json({ success: false, message: "Member or Guest authentication required" });
    }

    const query = { _id: id, deletedAt: null };
    if (memberId) query.hostMember = memberId;
    else if (guestId) query.hostGuest = guestId;

    const visitor = await Visitor.findOne(query);
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

    // Update relevant notifications to mark action as taken
    try {
      const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });
      if (visitorCategory) {
        await Notification.updateMany(
          {
            categoryId: visitorCategory._id,
            'metadata.routeParams.id': String(visitor._id),
            $or: [
              { 'to.memberId': memberId },
              { 'to.guestId': guestId }
            ],
            actionTaken: false
          },
          { $set: { actionTaken: true } }
        );
      }
    } catch (notifErr) {
      console.warn('acceptVisitor: failed to update notification actionTaken status:', notifErr.message);
    }

    // Send Notification to Visitor
    try {
      if (visitor.phone || visitor.email) {
        await visitor.populate([
          { path: 'hostMember', select: 'firstName lastName' },
          { path: 'building', select: 'name' }
        ]);

        const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });

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
          categoryId: visitorCategory?._id,
          metadata: {
            category: 'visitor',
            tags: ['visitor_accepted']
          },
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
    const guestId = req.user?.guestId;

    if (!memberId && !guestId) {
      return res.status(401).json({ success: false, message: "Member or Guest authentication required" });
    }

    const query = { _id: id, deletedAt: null };
    if (memberId) query.hostMember = memberId;
    else if (guestId) query.hostGuest = guestId;

    const visitor = await Visitor.findOne(query);
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

    // Update relevant notifications to mark action as taken
    try {
      const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });
      if (visitorCategory) {
        await Notification.updateMany(
          {
            categoryId: visitorCategory._id,
            'metadata.routeParams.id': String(visitor._id),
            $or: [
              { 'to.memberId': memberId },
              { 'to.guestId': guestId }
            ],
            actionTaken: false
          },
          { $set: { actionTaken: true } }
        );
      }
    } catch (notifErr) {
      console.warn('declineVisitor: failed to update notification actionTaken status:', notifErr.message);
    }

    // Send Notification to Visitor
    try {
      if (visitor.phone || visitor.email) {
        await visitor.populate([
          { path: 'building', select: 'name' }
        ]);

        const visitorCategory = await NotificationCategory.findOne({ name: 'Visitor Member Approval' });

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
          categoryId: visitorCategory?._id,
          metadata: {
            category: 'visitor',
            tags: ['visitor_declined']
          },
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

export const getVisitorQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const visitor = await Visitor.findOne({ _id: id, deletedAt: null });

    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    if (!visitor.qrToken) {
      return res.status(404).json({ success: false, message: "QR token not found for this visitor" });
    }

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(visitor.qrToken, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff"
      }
    });

    // Option 1: Return as JSON with data URL
    if (req.query.format === 'json') {
      return res.json({ success: true, data: { qrDataUrl } });
    }

    // Option 2: Return as Image (buffer)
    const qrBuffer = await QRCode.toBuffer(visitor.qrToken, {
      type: 'png',
      width: 300,
      margin: 2
    });

    res.setHeader('Content-Type', 'image/png');
    res.send(qrBuffer);

  } catch (error) {
    console.error("Generate QR Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
