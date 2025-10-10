import Notification from "../models/notificationModel.js";
import mongoose from "mongoose";

import { getSMSProvider } from "../services/notifications/smsProvider.js";
import { getEmailProvider } from "../services/notifications/emailProvider.js";
import renderer from "../services/notifications/renderer.js";
import { logCRUDActivity } from "../utils/activityLogger.js";

// Initialize providers
const smsProvider = getSMSProvider();
const emailProvider = getEmailProvider();

// Create and send notification
export const createNotification = async (req, res) => {
  try {
    const {
      channels,
      to,
      templateKey,
      templateVariables,
      content,
      type,
      title,
      metadata,
      scheduledAt,
      expiresAt,
      maxRetries,
      source,
      image
    } = req.body;

    // Validation
    if (!channels || (!channels.sms && !channels.email)) {
      return res.status(400).json({
        success: false,
        message: "At least one channel (sms or email) must be enabled"
      });
    }

    if (!to || (!to.phone && !to.email && !to.userId && !to.memberId && !to.clientId)) {
      return res.status(400).json({
        success: false,
        message: "At least one recipient identifier must be provided"
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Title is required"
      });
    }

    // Render content
    let renderedContent = {};
    if (templateKey) {
      try {
        const templateContent = renderer.renderTemplate(templateKey, templateVariables || {});
        renderedContent = {
          smsText: templateContent.sms,
          emailSubject: templateContent.subject,
          emailHtml: templateContent.html,
          emailText: templateContent.text
        };
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: `Template rendering failed: ${error.message}`
        });
      }
    } else if (content) {
      renderedContent = renderer.renderContent(content, templateVariables || {});
    } else {
      return res.status(400).json({
        success: false,
        message: "Either templateKey or content must be provided"
      });
    }

    // Validate channel-specific content
    if (channels.sms && !renderedContent.smsText) {
      return res.status(400).json({
        success: false,
        message: "SMS text is required when SMS channel is enabled"
      });
    }

    if (channels.email && (!renderedContent.emailSubject || !renderedContent.emailHtml)) {
      return res.status(400).json({
        success: false,
        message: "Email subject and HTML content are required when email channel is enabled"
      });
    }

    // Sanitize recipient object 'to'
    const toPayload = to || {};
    const cleanTo = {};
    if (toPayload.email && String(toPayload.email).trim()) cleanTo.email = String(toPayload.email).trim();
    if (toPayload.phone && String(toPayload.phone).trim()) cleanTo.phone = String(toPayload.phone).trim();
    if (toPayload.userId && mongoose.Types.ObjectId.isValid(toPayload.userId)) cleanTo.userId = toPayload.userId;
    if (toPayload.memberId && mongoose.Types.ObjectId.isValid(toPayload.memberId)) cleanTo.memberId = toPayload.memberId;
    if (toPayload.clientId && mongoose.Types.ObjectId.isValid(toPayload.clientId)) cleanTo.clientId = toPayload.clientId;

    // Create notification
    const notification = new Notification({
      type: type || 'system',
      channels,
      title,
      templateKey,
      templateVariables,
      content: renderedContent,
      image: image || undefined,
      metadata: metadata || {},
      to: cleanTo,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      maxRetries: maxRetries || 3,
      createdBy: req.user?.id,
      source: source || 'api',
      smsDelivery: channels.sms ? { status: 'pending' } : undefined,
      emailDelivery: channels.email ? { status: 'pending' } : undefined
    });

    await notification.save();

    // Log activity
    if (req.user) {
      await logCRUDActivity(req.user.id, 'CREATE', 'notification', notification._id, {
        channels,
        to,
        title
      });
    }

    // If scheduled for now or past, dispatch immediately
    const now = new Date();
    if (!scheduledAt || new Date(scheduledAt) <= now) {
      await dispatchNotification(notification);
    }

    res.status(201).json({
      success: true,
      data: notification,
      message: "Notification created successfully"
    });

  } catch (error) {
    console.error("Create notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create notification",
      error: error.message
    });
  }
};

// Get notifications with filters
export const getNotifications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      channel,
      status,
      type,
      category,
      tag,
      phone,
      email,
      userId,
      memberId,
      clientId,
      createdFrom,
      createdTo,
      scheduledFrom,
      scheduledTo,
      sort = '-createdAt'
    } = req.query;

    // Build query
    const query = {};

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { 'content.smsText': { $regex: q, $options: 'i' } },
        { 'content.emailSubject': { $regex: q, $options: 'i' } }
      ];
    }

    // Channel filter
    if (channel) {
      if (channel === 'sms') query['channels.sms'] = true;
      if (channel === 'email') query['channels.email'] = true;
    }

    // Status filter (any channel with this status)
    if (status) {
      query.$or = [
        { 'smsDelivery.status': status },
        { 'emailDelivery.status': status }
      ];
    }

    // Type and metadata filters
    if (type) query.type = type;
    if (category) query['metadata.category'] = category;
    if (tag) query['metadata.tags'] = tag;

    // Recipient filters
    if (phone) query['to.phone'] = phone;
    if (email) query['to.email'] = email;
    if (userId) query['to.userId'] = userId;
    if (memberId) query['to.memberId'] = memberId;
    if (clientId) query['to.clientId'] = clientId;

    // Date filters
    if (createdFrom || createdTo) {
      query.createdAt = {};
      if (createdFrom) query.createdAt.$gte = new Date(createdFrom);
      if (createdTo) query.createdAt.$lte = new Date(createdTo);
    }

    if (scheduledFrom || scheduledTo) {
      query.scheduledAt = {};
      if (scheduledFrom) query.scheduledAt.$gte = new Date(scheduledFrom);
      if (scheduledTo) query.scheduledAt.$lte = new Date(scheduledTo);
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('to.userId', 'name email')
        .populate('to.memberId', 'name email')
        .populate('to.clientId', 'companyName email')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query)
    ]);

    const baseResponse = {
      success: true,
      data: notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + notifications.length < total
      }
    };

    // Optional debug info when debug=1 is passed
    if (String(req.query.debug || '') === '1') {
      baseResponse.debug = {
        authType: req.authType,
        memberId: memberId || null,
        clientIdFromAuth: clientIdFromAuth || null,
        resolvedClientId: resolvedClientId ? String(resolvedClientId) : null,
        contextUsed
      };
    }

    res.json(baseResponse);

  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message
    });
  }
};

// Get notification by ID
export const getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findById(id)
      .populate('to.userId', 'name email phone')
      .populate('to.memberId', 'name email phone')
      .populate('to.clientId', 'companyName email phone')
      .populate('createdBy', 'name email');

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.json({
      success: true,
      data: notification
    });

  } catch (error) {
    console.error("Get notification by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification",
      error: error.message
    });
  }
};

// Mark notification as read/unread
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { isRead = true } = req.body;

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    notification.isRead = isRead;
    notification.readAt = isRead ? new Date() : null;
    await notification.save();

    // Log activity
    if (req.user) {
      await logCRUDActivity(req.user.id, 'UPDATE', 'notification', notification._id, {
        action: isRead ? 'marked_read' : 'marked_unread'
      });
    }

    res.json({
      success: true,
      data: notification,
      message: `Notification marked as ${isRead ? 'read' : 'unread'}`
    });

  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification",
      error: error.message
    });
  }
};

// Retry failed notification
export const retryNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { channels } = req.body; // Optional: specify which channels to retry

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    if (notification.canceled) {
      return res.status(400).json({
        success: false,
        message: "Cannot retry canceled notification"
      });
    }

    const retryResults = {};

    // Retry SMS if requested and eligible
    if ((!channels || channels.includes('sms')) && notification.channels.sms) {
      if (notification.canRetry('sms')) {
        notification.updateDeliveryStatus('sms', 'queued', { details: 'Manual retry initiated' });
        notification.incrementAttempt('sms');
        retryResults.sms = 'queued';
      } else {
        retryResults.sms = 'not_eligible';
      }
    }

    // Retry Email if requested and eligible
    if ((!channels || channels.includes('email')) && notification.channels.email) {
      if (notification.canRetry('email')) {
        notification.updateDeliveryStatus('email', 'queued', { details: 'Manual retry initiated' });
        notification.incrementAttempt('email');
        retryResults.email = 'queued';
      } else {
        retryResults.email = 'not_eligible';
      }
    }

    await notification.save();

    // Dispatch retry
    await dispatchNotification(notification);

    // Log activity
    if (req.user) {
      await logCRUDActivity(req.user.id, 'UPDATE', 'notification', notification._id, {
        action: 'retry',
        channels: retryResults
      });
    }

    res.json({
      success: true,
      data: notification,
      retryResults,
      message: "Notification retry initiated"
    });

  } catch (error) {
    console.error("Retry notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retry notification",
      error: error.message
    });
  }
};

// Cancel notification
export const cancelNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    notification.canceled = true;
    notification.cancelReason = reason || 'Manually canceled';

    // Cancel pending channels
    if (notification.channels.sms && ['pending', 'queued'].includes(notification.smsDelivery.status)) {
      notification.updateDeliveryStatus('sms', 'canceled', { details: reason });
    }

    if (notification.channels.email && ['pending', 'queued'].includes(notification.emailDelivery.status)) {
      notification.updateDeliveryStatus('email', 'canceled', { details: reason });
    }

    await notification.save();

    // Log activity
    if (req.user) {
      await logCRUDActivity(req.user.id, 'UPDATE', 'notification', notification._id, {
        action: 'canceled',
        reason
      });
    }

    res.json({
      success: true,
      data: notification,
      message: "Notification canceled successfully"
    });

  } catch (error) {
    console.error("Cancel notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel notification",
      error: error.message
    });
  }
};

// Get notifications for a specific member
export const getMemberNotifications = async (req, res) => {
  try {
    let memberId = req.memberId || req.query.memberId; // From auth middleware or query params
    let clientIdFromAuth = req.clientId; // From universal auth (member or client tokens)
    const user = req.user; // From universal auth (admin/staff/member)
    const client = req.client; // From universal auth (client tokens)
    const {
      page = 1,
      limit = 20,
      q,
      type,
      status,
      dateFrom,
      dateTo,
      sort = '-createdAt'
    } = req.query;
    
    // If we have a client object directly, use its ID
    if (client && client._id && !clientIdFromAuth) {
      clientIdFromAuth = client._id;
    }
    
    // Determine clientId: Prefer value provided by universal auth, otherwise derive from member
    let resolvedClientId = clientIdFromAuth || null;

    if (!resolvedClientId && memberId) {
      try {
        const Member = (await import('../models/memberModel.js')).default;
        const member = await Member.findById(memberId).select('client');
        if (member?.client) {
          resolvedClientId = member.client;
        }
      } catch (e) {
      }
    }

    if (!resolvedClientId && user?._id) {
      try {
        const Member = (await import('../models/memberModel.js')).default;
        const memberByUser = await Member.findOne({ user: user._id }).select('client _id');
        if (memberByUser?.client) {
          resolvedClientId = memberByUser.client;
          // Also set memberId if not already set
          if (!memberId && memberByUser._id) {
            memberId = memberByUser._id;
          }
        }
      } catch (e) {
      }
    }

    let query;
    let contextUsed = 'client';
    if (resolvedClientId) {
      query = { 'to.clientId': resolvedClientId };
    } else if (memberId) {
      query = { 'to.memberId': memberId };
      contextUsed = 'member';
    } else {
      console.log('getMemberNotifications Debug - No context found:', {
        memberId,
        clientIdFromAuth,
        resolvedClientId,
        hasUser: !!user,
        hasClient: !!client,
        userId: user?._id,
        clientId: client?._id
      });
      return res.status(403).json({
        success: false,
        message: 'No client or member context found for this user',
      });
    }

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { 'content.smsText': { $regex: q, $options: 'i' } },
        { 'content.emailSubject': { $regex: q, $options: 'i' } }
      ];
    }

    if (type) query.type = type;
    if (status) {
      query.$or = [
        { 'smsDelivery.status': status },
        { 'emailDelivery.status': status }
      ];
    }

    // Date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('to.clientId', 'companyName email')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + notifications.length < total
      }
    });

  } catch (error) {
    console.error("Get member notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch member notifications",
      error: error.message
    });
  }
};

// Get notifications strictly for the authenticated memberId (no client association)
export const getMemberOnlyNotifications = async (req, res) => {
  try {
    const memberId = req.memberId; // Injected by universalAuthMiddleware for roleName === 'member'
    const {
      page = 1,
      limit = 20,
      q,
      type,
      status,
      dateFrom,
      dateTo,
      sort = '-createdAt',
      debug = '0'
    } = req.query;

    if (!memberId) {
      return res.status(403).json({
        success: false,
        message: 'No member context found on the token',
      });
    }

    let memberObjectId = memberId;
    try {
      memberObjectId = new mongoose.Types.ObjectId(String(memberId));
    } catch (_) {
    }
    const query = { 'to.memberId': memberObjectId };
    if (debug === '1') {
      console.log('getMemberOnlyNotifications Debug:', {
        memberId: String(memberId),
        memberIdType: typeof memberId,
        memberObjectId: String(memberObjectId),
        query: JSON.stringify(query, null, 2)
      });
      
      // Also check if there are any notifications with this memberId at all
      const allNotificationsWithMemberId = await Notification.find({ 'to.memberId': { $exists: true } })
        .select('to.memberId title')
        .limit(10);
      console.log('Sample notifications with memberId:', allNotificationsWithMemberId.map(n => ({
        id: n._id,
        title: n.title,
        memberId: String(n.to?.memberId),
        memberIdType: typeof n.to?.memberId
      })));
    }

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { 'content.smsText': { $regex: q, $options: 'i' } },
        { 'content.emailSubject': { $regex: q, $options: 'i' } }
      ];
    }

    if (type) query.type = type;
    if (status) {
      query.$or = [
        { 'smsDelivery.status': status },
        { 'emailDelivery.status': status }
      ];
    }

    // Date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('to.memberId', 'firstName lastName email')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query)
    ]);

    const response = {
      success: true,
      data: notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + notifications.length < total
      }
    };

    // Add debug info if requested
    if (debug === '1') {
      response.debug = {
        memberId: String(memberId),
        memberIdType: typeof memberId,
        query: query,
        totalFound: total
      };
    }

    res.json(response);

  } catch (error) {
    console.error('Get member-only notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member-only notifications',
      error: error.message
    });
  }
};

// Get notification statistics
export const getNotificationStats = async (req, res) => {
  try {
    const { from, to } = req.query;
    
    const dateFilter = {};
    if (from || to) {
      dateFilter.createdAt = {};
      if (from) dateFilter.createdAt.$gte = new Date(from);
      if (to) dateFilter.createdAt.$lte = new Date(to);
    }

    const [
      totalNotifications,
      smsStats,
      emailStats,
      typeStats,
      recentActivity
    ] = await Promise.all([
      Notification.countDocuments(dateFilter),
      
      Notification.aggregate([
        { $match: { ...dateFilter, 'channels.sms': true } },
        { $group: { 
          _id: '$smsDelivery.status', 
          count: { $sum: 1 } 
        }}
      ]),
      
      Notification.aggregate([
        { $match: { ...dateFilter, 'channels.email': true } },
        { $group: { 
          _id: '$emailDelivery.status', 
          count: { $sum: 1 } 
        }}
      ]),
      
      Notification.aggregate([
        { $match: dateFilter },
        { $group: { 
          _id: '$type', 
          count: { $sum: 1 } 
        }}
      ]),
      
      Notification.find(dateFilter)
        .sort({ createdAt: -1 })
        .limit(10)
        .select('title type createdAt smsDelivery.status emailDelivery.status')
    ]);

    res.json({
      success: true,
      data: {
        total: totalNotifications,
        sms: smsStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {}),
        email: emailStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {}),
        byType: typeStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {}),
        recentActivity
      }
    });

  } catch (error) {
    console.error("Get notification stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification statistics",
      error: error.message
    });
  }
};

// Helper function to dispatch notification
async function dispatchNotification(notification) {
  const promises = [];

  // Dispatch SMS
  if (notification.channels.sms && notification.smsDelivery.status === 'pending') {
    promises.push(sendSMS(notification));
  }

  // Dispatch Email
  if (notification.channels.email && notification.emailDelivery.status === 'pending') {
    promises.push(sendEmail(notification));
  }

  await Promise.allSettled(promises);
  await notification.save();
}

// Helper function to send SMS
async function sendSMS(notification) {
  try {
    if (!notification.to.phone) {
      throw new Error('Phone number not provided');
    }

    notification.updateDeliveryStatus('sms', 'queued', { details: 'Sending SMS' });
    notification.smsDelivery.provider = 'smswaale';

    const result = await smsProvider.send({
      toPhone: notification.to.phone,
      text: notification.content.smsText
    });

    if (result.success) {
      notification.updateDeliveryStatus('sms', 'sent', {
        details: 'SMS sent successfully',
        providerMessageId: result.providerMessageId,
        providerResponse: result.providerResponse
      });
    } else {
      notification.updateDeliveryStatus('sms', 'failed', {
        error: result.error,
        errorCode: result.errorCode,
        providerResponse: result.providerResponse
      });
    }

  } catch (error) {
    notification.updateDeliveryStatus('sms', 'failed', {
      error: error.message,
      errorCode: 'DISPATCH_ERROR'
    });
  }
}

// Helper function to send Email
async function sendEmail(notification) {
  try {
    if (!notification.to.email) {
      throw new Error('Email address not provided');
    }

    notification.updateDeliveryStatus('email', 'queued', { details: 'Sending email' });
    notification.emailDelivery.provider = 'nodemailer';

    const result = await emailProvider.send({
      toEmail: notification.to.email,
      subject: notification.content.emailSubject,
      html: notification.content.emailHtml,
      text: notification.content.emailText
    });

    if (result.success) {
      notification.updateDeliveryStatus('email', 'sent', {
        details: 'Email sent successfully',
        providerMessageId: result.providerMessageId,
        providerResponse: result.providerResponse
      });
    } else {
      notification.updateDeliveryStatus('email', 'failed', {
        error: result.error,
        errorCode: result.errorCode,
        providerResponse: result.providerResponse
      });
    }

  } catch (error) {
    notification.updateDeliveryStatus('email', 'failed', {
      error: error.message,
      errorCode: 'DISPATCH_ERROR'
    });
  }
}
// Get notifications for community users by building context
export const getCommunityNotifications = async (req, res) => {
  try {
    const buildingId = req.buildingId || req.building?._id;
    const {
      page = 1,
      limit = 20,
      q,
      channel,
      status,
      type,
      dateFrom,
      dateTo,
      sort = '-createdAt'
    } = req.query;

    if (!buildingId) {
      return res.status(403).json({ success: false, message: 'No building context found for this user' });
    }

    // Find clients in this building
    const Client = (await import('../models/clientModel.js')).default;
    const Member = (await import('../models/memberModel.js')).default;
    const clients = await Client.find({ building: buildingId }).select('_id');
    const clientIds = clients.map(c => c._id);

    // Find members whose client is in those clients
    const members = clientIds.length
      ? await Member.find({ client: { $in: clientIds } }).select('_id')
      : [];
    const memberIds = members.map(m => m._id);

    // If no clients and no members found, return empty set early
    if (clientIds.length === 0 && memberIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: { currentPage: parseInt(page), totalPages: 0, totalRecords: 0, hasMore: false },
        ...(String(req.query.debug || '') === '1' ? { debug: { buildingId: String(buildingId), clientCount: 0, memberCount: 0 } } : {})
      });
    }

    // Build base query: notifications to these clients or these members
    const query = {
      $or: [
        clientIds.length ? { 'to.clientId': { $in: clientIds } } : null,
        memberIds.length ? { 'to.memberId': { $in: memberIds } } : null
      ].filter(Boolean)
    };

    // Text search
    if (q) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { 'content.smsText': { $regex: q, $options: 'i' } },
          { 'content.emailSubject': { $regex: q, $options: 'i' } }
        ]
      });
    }

    // Channel filter
    if (channel) {
      if (channel === 'sms') query['channels.sms'] = true;
      if (channel === 'email') query['channels.email'] = true;
    }

    // Status filter (any channel with this status)
    if (status) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { 'smsDelivery.status': status },
          { 'emailDelivery.status': status }
        ]
      });
    }

    if (type) query.type = type;

    // Date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('to.userId', 'name email')
        .populate('to.memberId', 'firstName lastName email')
        .populate('to.clientId', 'companyName email')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query)
    ]);

    const resp = {
      success: true,
      data: notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + notifications.length < total
      }
    };

    if (String(req.query.debug || '') === '1') {
      resp.debug = {
        buildingId: String(buildingId),
        clientCount: clientIds.length,
        memberCount: memberIds.length
      };
    }

    res.json(resp);
  } catch (error) {
    console.error('Get community notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch community notifications', error: error.message });
  }
};