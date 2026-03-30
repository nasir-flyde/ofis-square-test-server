import Notification from "../models/notificationModel.js";
import Member from "../models/memberModel.js";
import User from "../models/userModel.js";
import Role from "../models/roleModel.js";
import NotificationCategory from "../models/NotificationCategoryModel.js";
import mongoose from "mongoose";

import admin from "../utils/firebase.js";
import { getSMSProvider } from "../services/notifications/smsProvider.js";
import { getEmailProvider } from "../services/notifications/emailProvider.js";
import { renderTemplateByKey, renderArbitraryContent, getTemplateByKey } from "../services/notifications/templateService.js";
import { logCRUDActivity } from "../utils/activityLogger.js";

// Initialize providers
const smsProvider = getSMSProvider();
const emailProvider = getEmailProvider();

const resolveCategoryId = async (metadata = {}, title = '', content = {}) => {
  try {
    const categories = await NotificationCategory.find({}).select('name _id');
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name] = cat._id.toString();
    });

    // 1. Explicit mapping from metadata name
    const metaCat = metadata.category?.[0]?.toUpperCase() + metadata.category?.slice(1).toLowerCase();
    if (categoryMap[metaCat]) return categoryMap[metaCat];

    // 2. Keyword based resolution
    const searchStr = `${title} ${content.smsText || ''} ${metadata.tags?.join(' ') || ''}`.toLowerCase();

    if (searchStr.includes('event')) return categoryMap['Events'];
    if (searchStr.includes('ticket')) return categoryMap['Tickets'];
    if (searchStr.includes('bill') || searchStr.includes('invoice') || searchStr.includes('payment')) return categoryMap['Billing'];
    if (searchStr.includes('booking') || searchStr.includes('room') || searchStr.includes('pass')) return categoryMap['Bookings'];

    return null;
  } catch (error) {
    console.error('[resolveCategoryId] Error resolving category ID:', error);
    return null;
  }
};

// Create and send notification
export const createNotification = async (req, res) => {
  try {
    const {
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
      image,
      pushToken
    } = req.body;

    let { channels } = req.body;

    // Default channels to push and inApp if not provided
    if (!channels) {
      channels = { push: true, inApp: true };
    } else {
      if (channels.push === undefined) channels.push = true;
      if (channels.inApp === undefined) channels.inApp = true;
    }

    // Validation
    if (!channels || (!channels.sms && !channels.email && !channels.push && !channels.inApp)) {
      return res.status(400).json({
        success: false,
        message: "At least one channel (sms, email, push or inApp) must be enabled"
      });
    }

    if (!to || (!to.phone && !to.email && !to.userId && !to.memberId && !to.clientId && !to.roleNames)) {
      return res.status(400).json({
        success: false,
        message: "At least one recipient identifier (phone, email, userId, memberId, clientId or roleNames) must be provided"
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
    let mergedMetadata = { ...(metadata || {}) };
    if (templateKey) {
      try {
        const templateContent = await renderTemplateByKey(templateKey, templateVariables || {});
        renderedContent = {
          smsText: templateContent.sms,
          emailSubject: templateContent.subject,
          emailHtml: templateContent.html,
          emailText: templateContent.text,
          inAppTitle: templateContent.inAppTitle,
          inAppBody: templateContent.inAppBody
        };
        // Merge template default metadata if present
        try {
          const tplDoc = await getTemplateByKey(templateKey);
          if (tplDoc?.defaults?.metadata) {
            mergedMetadata = { ...tplDoc.defaults.metadata, ...mergedMetadata };
          }
        } catch (_) { }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: `Template rendering failed: ${error.message}`
        });
      }
    } else if (content) {
      renderedContent = renderArbitraryContent(content, templateVariables || {});
    } else {
      return res.status(400).json({
        success: false,
        message: "Either templateKey or content must be provided"
      });
    }

    // Auto-resolve category if not provided
    let category = req.body.categoryId || req.body.category;
    if (!category) {
      category = await resolveCategoryId(mergedMetadata, title, renderedContent);
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
    if (toPayload.pushToken && String(toPayload.pushToken).trim()) cleanTo.pushToken = String(toPayload.pushToken).trim();
    if (toPayload.userId && mongoose.Types.ObjectId.isValid(toPayload.userId)) cleanTo.userId = toPayload.userId;
    if (toPayload.memberId && mongoose.Types.ObjectId.isValid(toPayload.memberId)) cleanTo.memberId = toPayload.memberId;
    if (toPayload.clientId && mongoose.Types.ObjectId.isValid(toPayload.clientId)) cleanTo.clientId = toPayload.clientId;
    if (toPayload.roleNames && Array.isArray(toPayload.roleNames)) cleanTo.roleNames = toPayload.roleNames;
    if (pushToken && String(pushToken).trim()) cleanTo.pushToken = String(pushToken).trim();

    // Resolve userId if not provided but other identifiers exist
    if (!cleanTo.userId) {
      if (cleanTo.memberId) {
        try {
          const MemberModel = (await import('../models/memberModel.js')).default;
          const member = await MemberModel.findById(cleanTo.memberId).select('user');
          if (member?.user) cleanTo.userId = member.user;
        } catch (err) { }
      } else if (cleanTo.phone || cleanTo.email) {
        try {
          const userDoc = await User.findOne({
            $or: [
              cleanTo.email ? { email: cleanTo.email } : null,
              cleanTo.phone ? { phone: cleanTo.phone } : null
            ].filter(Boolean)
          }).select('_id');
          if (userDoc) cleanTo.userId = userDoc._id;
        } catch (err) { }
      }
    }

    // Check for role-based targeting
    if (cleanTo.roleNames && cleanTo.roleNames.length > 0) {
      // Resolve roles to member/user IDs
      const roles = await Role.find({ roleName: { $in: cleanTo.roleNames } }).select('_id');
      const roleIds = roles.map(r => r._id);

      const [members, users] = await Promise.all([
        Member.find({ role: { $in: cleanTo.roleNames } }).select('_id fcmTokens phone email user'),
        User.find({ role: { $in: roleIds } }).select('_id phone email')
      ]);

      const recipients = [
        ...members.map(m => ({
          memberId: m._id,
          userId: m.user,
          phone: m.phone,
          email: m.email,
          pushToken: m.fcmTokens?.[0]
        })),
        ...users.map(u => ({
          userId: u._id,
          phone: u.phone,
          email: u.email
        }))
      ];

      const notifications = recipients.map(recipient => {
        const payload = {
          ...cleanTo,
          ...recipient
        };
        return new Notification({
          type: type || 'system',
          channels,
          title,
          templateKey,
          templateVariables,
          content: renderedContent,
          image: image || undefined,
          metadata: mergedMetadata,
          categoryId: category || undefined,
          to: payload,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          maxRetries: maxRetries || 3,
          createdBy: req.user?.id,
          source: source || 'api',
          smsDelivery: channels.sms ? { status: 'pending' } : undefined,
          emailDelivery: channels.email ? { status: 'pending' } : undefined,
          pushDelivery: channels.push ? { status: 'pending' } : undefined,
          inAppDelivery: channels.inApp ? { status: 'pending' } : undefined
        });
      });

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`[notificationController] Inserted ${notifications.length} role-based notifications with userIds`);

        // Dispatch all (if scheduled for now)
        if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
          for (const n of notifications) {
            dispatchNotification(n); // Background dispatch
          }
        }

        return res.status(201).json({
          success: true,
          count: notifications.length,
          message: `${notifications.length} notifications created for roles: ${cleanTo.roleNames.join(', ')}`
        });
      }
    }

    // Single recipient flow (fallback or explicit)
    const notification = new Notification({
      type: type || 'system',
      channels,
      title,
      templateKey,
      templateVariables,
      content: renderedContent,
      image: image || undefined,
      metadata: mergedMetadata,
      categoryId: category || undefined,
      to: cleanTo,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      maxRetries: maxRetries || 3,
      createdBy: req.user?.id,
      source: source || 'api',
      smsDelivery: channels.sms ? { status: 'pending' } : undefined,
      emailDelivery: channels.email ? { status: 'pending' } : undefined,
      pushDelivery: channels.push ? { status: 'pending' } : undefined,
      inAppDelivery: channels.inApp ? { status: 'pending' } : undefined
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
        .populate('to.userId', 'name email phone')
        .populate('to.memberId', 'firstName lastName email phone')
        .populate('to.clientId', 'companyName email phone')
        .populate('createdBy', 'name email')
        .populate('category', 'name description')
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
      return res.status(404).json({ success: false, message: "Notification not found" });
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

// Get notifications by category
export const getNotificationsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      Notification.find({ category: categoryId, deletedAt: null })
        .populate('createdBy', 'name email')
        .populate('category', 'name description')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments({ category: categoryId, deletedAt: null })
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
    console.error("Get notifications by category error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications by category", error: error.message });
  }
};

// Get notifications by member ID
export const getNotificationsByMemberId = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { page = 1, limit = 20, sort = '-createdAt' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID' });
    }

    const filter = { 'to.memberId': memberId, deletedAt: null };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .populate('createdBy', 'name email')
        .populate('category', 'name description')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(filter)
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
    console.error("Get notifications by member error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications by member", error: error.message });
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

// Update notification status (isActive)
export const updateNotificationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { isActive },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({ success: true, data: notification });
  } catch (error) {
    console.error("Update notification status error:", error);
    res.status(500).json({ success: false, message: "Failed to update notification status", error: error.message });
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification", error: error.message });
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
    const memberId = req.memberId;
    const roleName = String((req.userRole?.roleName || req.user?.roleName || '')).toLowerCase();
    const isOnDemand = roleName === 'ondemanduser';
    const guestId = req.guestId;
    const userId = req.user?._id;

    const {
      page = 1,
      limit = 20,
      q,
      type,
      status,
      channel,
      categoryId,
      dateFrom,
      dateTo,
      sort = '-createdAt',
      debug = '0'
    } = req.query;

    if (!memberId && !isOnDemand) {
      return res.status(403).json({
        success: false,
        message: 'No member context found on the token',
      });
    }

    if (isOnDemand && !guestId) {
      return res.status(403).json({
        success: false,
        message: 'Guest context not found',
      });
    }

    let query = {};
    if (isOnDemand) {
      if (userId) {
        query = { 'to.userId': userId };
      } else {
        return res.status(403).json({
          success: false,
          message: 'User ID not found for guest',
        });
      }
    } else {
      let memberObjectId = memberId;
      try {
        memberObjectId = new mongoose.Types.ObjectId(String(memberId));
      } catch (_) {
      }
      query = { 'to.memberId': memberObjectId };
    }
    if (categoryId) {
      query.categoryId = categoryId;
    }

    // Channel filter
    if (channel) {
      if (channel === 'sms') query['channels.sms'] = true;
      if (channel === 'email') query['channels.email'] = true;
      if (channel === 'push') query['channels.push'] = true;
      if (channel === 'inApp') query['channels.inApp'] = true;
    }
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
        .populate('to.userId', 'name email phone')
        .populate('createdBy', 'name email')
        .populate('categoryId', 'name')
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
        {
          $group: {
            _id: '$smsDelivery.status',
            count: { $sum: 1 }
          }
        }
      ]),

      Notification.aggregate([
        { $match: { ...dateFilter, 'channels.email': true } },
        {
          $group: {
            _id: '$emailDelivery.status',
            count: { $sum: 1 }
          }
        }
      ]),

      Notification.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        }
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

  // Dispatch Push
  if (notification.channels.push && notification.pushDelivery.status === 'pending') {
    promises.push(sendPush(notification));
  }

  // Dispatch In-App
  if (notification.channels.inApp && notification.inAppDelivery.status === 'pending') {
    promises.push(sendInApp(notification));
  }

  console.log(`[notificationController:dispatchNotification] Awaiting ${promises.length} delivery promises for ID: ${notification._id}`);
  await Promise.allSettled(promises);
  await notification.save();
  console.log(`[notificationController:dispatchNotification] Saved notification ID: ${notification._id} with statuses: SMS=${notification.smsDelivery?.status}, Email=${notification.emailDelivery?.status}`);
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
    notification.emailDelivery.provider = emailProvider.name || 'zeptomail';

    const result = await emailProvider.send({
      toEmail: notification.to.email,
      subject: notification.content.emailSubject,
      html: notification.content.emailHtml,
      text: notification.content.emailText
    });

    if (result.success) {
      console.log(`[notificationController:sendEmail] Email sent successfully to ${notification.to.email}`);
      notification.updateDeliveryStatus('email', 'sent', {
        details: 'Email sent successfully',
        providerMessageId: result.providerMessageId,
        providerResponse: result.providerResponse
      });
    } else {
      console.error(`[notificationController:sendEmail] Email failed for ${notification.to.email}:`, result.error);
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

// Helper function to send Push Notification
async function sendPush(notification) {
  try {
    const tokens = new Set();

    // 1. Add explicit pushToken if present
    if (notification.to.pushToken) {
      tokens.add(notification.to.pushToken);
    }

    // 2. Fetch tokens from User model if userId is present
    if (notification.to.userId) {
      const user = await User.findById(notification.to.userId).select('fcmTokens');
      if (user?.fcmTokens?.length) {
        user.fcmTokens.forEach(t => tokens.add(t));
      }
    }

    // 3. Fetch tokens from Member model if memberId is present
    if (notification.to.memberId) {
      const member = await Member.findById(notification.to.memberId).select('fcmTokens');
      if (member?.fcmTokens?.length) {
        member.fcmTokens.forEach(t => tokens.add(t));
      }
    }

    const tokenList = Array.from(tokens).filter(t => t && typeof t === 'string');

    if (tokenList.length === 0) {
      notification.updateDeliveryStatus('push', 'skipped', { details: 'No FCM tokens found for user/member' });
      return;
    }

    notification.updateDeliveryStatus('push', 'queued', { details: `Sending Push to ${tokenList.length} token(s)` });

    const message = {
      notification: {
        title: notification.title,
        body: notification.content.smsText || notification.title,
      },
      data: {
        notificationId: notification._id.toString(),
        ...(notification.metadata || {})
      },
      tokens: tokenList
    };

    if (admin.apps.length > 0) {
      const response = await admin.messaging().sendEachForMulticast(message);
      
      const successCount = response.successCount;
      const failureCount = response.failureCount;

      notification.updateDeliveryStatus('push', successCount > 0 ? 'sent' : 'failed', {
        details: `Push processed: ${successCount} success, ${failureCount} failure`,
        providerMessageId: response.responses?.[0]?.messageId,
        providerResponse: { 
          successCount, 
          failureCount,
          results: response.responses.map(r => ({ success: r.success, error: r.error?.message }))
        }
      });
    } else {
      throw new Error('Firebase Admin not initialized');
    }

  } catch (error) {
    console.error('[sendPush] Error:', error);
    notification.updateDeliveryStatus('push', 'failed', {
      error: error.message,
      errorCode: 'PUSH_ERROR'
    });
  }
}

// Helper function to handle In-App Delivery
async function sendInApp(notification) {
  try {
    // In-app is "delivered" as soon as it's saved in DB and ready for portal retrieval
    notification.updateDeliveryStatus('inApp', 'delivered', { details: 'Ready in portal' });
  } catch (error) {
    notification.updateDeliveryStatus('inApp', 'failed', {
      error: error.message,
      errorCode: 'INAPP_ERROR'
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

// ─── Community Team Custom Notifications ──────────────────────────────────────
// POST /api/community/notifications/send
// Audience options:
//   audienceType = "all_members"  → every member in the community's building
//   audienceType = "clients"      → users whose client.building === buildingId
//   audienceType = "specific"     → single memberId; must belong to building
// Channels: email, sms, inApp (any combination)
export const sendCommunityCustomNotification = async (req, res) => {
  try {
    const buildingId = req.buildingId;
    if (!buildingId) {
      return res.status(400).json({ success: false, message: 'No building context found on token' });
    }

    const {
      title,
      message,          // plain-text body used for SMS + inApp
      emailSubject,     // optional: falls back to title
      emailHtml,        // optional: falls back to <p>message</p>
      audienceType,     // 'all_members' | 'clients' | 'specific'
      memberId,         // required when audienceType === 'specific'
      channels = {}     // { email, sms, inApp }
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });
    if (!message) return res.status(400).json({ success: false, message: 'message is required' });

    const enabledChannels = {
      sms: !!channels.sms,
      email: !!channels.email,
      inApp: !!channels.inApp,
      push: false
    };

    if (!enabledChannels.sms && !enabledChannels.email && !enabledChannels.inApp) {
      return res.status(400).json({ success: false, message: 'At least one channel (sms, email, inApp) must be enabled' });
    }

    if (enabledChannels.sms && !message) {
      return res.status(400).json({ success: false, message: 'message (SMS text) is required when SMS is enabled' });
    }

    if (enabledChannels.email) {
      const subj = emailSubject || title;
      const html = emailHtml || `<p>${message}</p>`;
      if (!subj || !html) {
        return res.status(400).json({ success: false, message: 'emailSubject and emailHtml are required when email is enabled' });
      }
    }

    const validTypes = ['all_members', 'clients', 'specific'];
    if (!audienceType || !validTypes.includes(audienceType)) {
      return res.status(400).json({ success: false, message: `audienceType must be one of: ${validTypes.join(', ')}` });
    }

    if (audienceType === 'specific' && !memberId) {
      return res.status(400).json({ success: false, message: 'memberId is required for specific audience' });
    }

    // ── Dynamically import models (avoid circular dep issues) ─────────────────
    const ClientModel = (await import('../models/clientModel.js')).default;
    const MemberModel = (await import('../models/memberModel.js')).default;

    // Build content object (shared across all recipients)
    const content = {
      smsText: enabledChannels.sms ? message : undefined,
      emailSubject: enabledChannels.email ? (emailSubject || title) : undefined,
      emailHtml: enabledChannels.email ? (emailHtml || `<p>${message}</p>`) : undefined,
      emailText: enabledChannels.email ? message : undefined,
      inAppTitle: enabledChannels.inApp ? title : undefined,
      inAppBody: enabledChannels.inApp ? message : undefined
    };

    // ── Resolve recipients ────────────────────────────────────────────────────
    let recipientDocs = [];

    if (audienceType === 'all_members') {
      // All members whose associated client belongs to this building
      const clients = await ClientModel.find({ building: buildingId }).select('_id');
      const clientIds = clients.map(c => c._id);

      recipientDocs = await MemberModel.find({ client: { $in: clientIds } })
        .select('_id user phone email fcmTokens');

    } else if (audienceType === 'clients') {
      // The primary contact (user) of each client in this building
      // We target the Client document's email / phone directly
      const clients = await ClientModel.find({ building: buildingId })
        .select('_id email phone contactPerson user');

      // Map clients → pseudo-recipient objects
      recipientDocs = clients.map(cl => ({
        _id: null,
        user: cl.user || null,
        phone: cl.phone,
        email: cl.email,
        // store clientId for DB record
        _clientId: cl._id
      }));

    } else if (audienceType === 'specific') {
      // Validate that this member belongs to the building
      const clients = await ClientModel.find({ building: buildingId }).select('_id');
      const clientIds = clients.map(c => String(c._id));

      const m = await MemberModel.findById(memberId).select('_id user phone email fcmTokens client');
      if (!m) return res.status(404).json({ success: false, message: 'Member not found' });

      if (!clientIds.includes(String(m.client))) {
        return res.status(403).json({ success: false, message: 'Member does not belong to your building' });
      }
      recipientDocs = [m];
    }

    if (recipientDocs.length === 0) {
      return res.status(200).json({ success: true, count: 0, message: 'No recipients found for the specified audience' });
    }

    // ── Create Notification documents ─────────────────────────────────────────
    const notifications = recipientDocs.map(r => {
      const toPayload = {};
      if (r._id) toPayload.memberId = r._id;
      if (r._clientId) toPayload.clientId = r._clientId;
      if (r.user) toPayload.userId = r.user;
      if (r.email) toPayload.email = r.email;
      if (r.phone) toPayload.phone = r.phone;

      return new Notification({
        type: 'system',
        channels: enabledChannels,
        title,
        content,
        to: toPayload,
        source: 'community_portal',
        createdBy: req.user?._id || req.userId,
        scheduledAt: new Date(),
        maxRetries: 3,
        smsDelivery: enabledChannels.sms ? { status: 'pending' } : undefined,
        emailDelivery: enabledChannels.email ? { status: 'pending' } : undefined,
        inAppDelivery: enabledChannels.inApp ? { status: 'pending' } : undefined,
        pushDelivery: undefined
      });
    });

    await Notification.insertMany(notifications);

    // Dispatch immediately (fire-and-forget)
    for (const n of notifications) {
      dispatchNotification(n);
    }

    return res.status(201).json({
      success: true,
      count: notifications.length,
      message: `${notifications.length} notification(s) queued successfully`
    });

  } catch (error) {
    console.error('[sendCommunityCustomNotification] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send notification', error: error.message });
  }
};