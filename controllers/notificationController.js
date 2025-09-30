import Notification from "../models/notificationModel.js";
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
      source
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

    // Create notification
    const notification = new Notification({
      type: type || 'system',
      channels,
      title,
      templateKey,
      templateVariables,
      content: renderedContent,
      metadata: metadata || {},
      to,
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
