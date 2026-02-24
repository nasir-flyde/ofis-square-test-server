import Notification from '../models/notificationModel.js';
import Member from '../models/memberModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import NotificationCategory from '../models/NotificationCategoryModel.js';
import admin from '../utils/firebase.js';
import { getSMSProvider } from '../services/notifications/smsProvider.js';
import { getEmailProvider } from '../services/notifications/emailProvider.js';
import { renderTemplateByKey, renderArbitraryContent } from '../services/notifications/templateService.js';

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

/**
 * Send a notification using template or custom content
 * @param {Object} options - Notification options
 * @param {Object} options.to - Recipient information
 * @param {boolean} options.channels - Channels to send (sms, email)
 * @param {string} options.templateKey - Template key (optional)
 * @param {Object} options.templateVariables - Template variables (optional)
 * @param {Object} options.content - Custom content (optional)
 * @param {string} options.title - Notification title
 * @param {Object} options.metadata - Additional metadata
 * @param {string} options.createdBy - User ID who created the notification
 * @param {string} options.source - Source of notification
 * @returns {Promise<Object>} Created notification
 */
export const sendNotification = async (options) => {
  try {
    const {
      to,
      channels = { push: true, inApp: true }, // Default to Push and In-App
      templateKey,
      templateVariables,
      content,
      title,
      metadata = {},
      createdBy,
      source = 'system',
      scheduledAt,

      type = 'system',
      attachments = []
    } = options;

    // Ensure push and inApp are true if channels were partially provided
    if (channels) {
      if (channels.push === undefined) channels.push = true;
      if (channels.inApp === undefined) channels.inApp = true;
    }

    console.log(`[notificationHelper:sendNotification] Attachments received: ${attachments?.length || 0}`);

    // Validate required fields
    if (!channels || (!channels.sms && !channels.email && !channels.push && !channels.inApp)) {
      throw new Error('At least one channel must be enabled');
    }

    if (!to || (!to.phone && !to.email && !to.userId && !to.memberId && !to.clientId && !to.roleNames)) {
      throw new Error('At least one recipient identifier must be provided');
    }

    if (!title) {
      throw new Error('Title is required');
    }

    // Render content
    let renderedContent = {};
    let localVariables = { ...(templateVariables || {}) };

    if (templateKey) {
      // Add Template Design ID as requested
      localVariables.templateDesignId = "700000000000000000000001";

      // logic for greeting
      if (!localVariables.greeting) {
        let companyName = localVariables.companyName || null;
        if (!companyName) {
          try {
            if (to.clientId) {
              const Client = (await import('../models/clientModel.js')).default;
              const clientDoc = await Client.findById(to.clientId).select('companyName');
              if (clientDoc) companyName = clientDoc.companyName;
            } else if (to.memberId) {
              const Member = (await import('../models/memberModel.js')).default;
              const memberDoc = await Member.findById(to.memberId).populate('client', 'companyName');
              if (memberDoc?.client?.companyName) {
                companyName = memberDoc.client.companyName;
              }
            }
          } catch (err) {
            console.error('[notificationHelper] Error fetching company name for greeting:', err);
          }
        }
        localVariables.greeting = companyName || 'Ofis Square';
      }

      const templateContent = await renderTemplateByKey(templateKey, localVariables);
      renderedContent = {
        smsText: templateContent.sms,
        emailSubject: templateContent.subject,
        emailHtml: templateContent.html,
        emailText: templateContent.text,
        inAppTitle: templateContent.inAppTitle,
        inAppBody: templateContent.inAppBody
      };
    } else if (content) {
      renderedContent = renderArbitraryContent(content, templateVariables || {});
    } else {
      throw new Error('Either templateKey or content must be provided');
    }

    // Auto-resolve category if not provided
    let category = options.categoryId || options.category;
    if (!category) {
      category = await resolveCategoryId(metadata, title, renderedContent);
    }

    // Resolve userId if not provided but other identifiers exist
    if (!to.userId) {
      if (to.memberId) {
        try {
          const MemberModel = (await import('../models/memberModel.js')).default;
          const member = await MemberModel.findById(to.memberId).select('user');
          if (member?.user) to.userId = member.user;
        } catch (err) {
          console.error('[notificationHelper] Error resolving userId from memberId:', err);
        }
      } else if (to.phone || to.email) {
        try {
          const query = {};
          if (to.phone) query.phone = to.phone;
          if (to.email) query.email = to.email;
          const userDoc = await User.findOne(query).select('_id');
          if (userDoc) to.userId = userDoc._id;
        } catch (err) {
          console.error('[notificationHelper] Error resolving userId from phone/email:', err);
        }
      }
    }

    // Check for role-based targeting
    if (to.roleNames && to.roleNames.length > 0) {
      const roles = await Role.find({ roleName: { $in: to.roleNames } }).select('_id');
      const roleIds = roles.map(r => r._id);

      const [members, users] = await Promise.all([
        Member.find({ role: { $in: to.roleNames } }).select('_id fcmTokens phone email user'),
        User.find({ role: { $in: roleIds } }).select('_id phone email')
      ]);

      const recipients = [
        ...members.map(m => ({
          memberId: m._id,
          userId: m.user, // Attach userId from member
          phone: m.phone,
          email: m.email,
          pushToken: m.fcmTokens?.[0]
        })),
        ...users.map(u => ({
          userId: u._id, // User targeting always has userId
          phone: u.phone,
          email: u.email
        }))
      ];

      const notifications = recipients.map(recipient => {
        const payload = { ...to, ...recipient };
        return new Notification({
          type,
          channels,
          title,
          templateKey,
          templateVariables,
          content: renderedContent,
          metadata: { ...metadata },
          to: payload,
          categoryId: category || undefined,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
          createdBy,
          source,
          smsDelivery: channels.sms ? { status: 'pending' } : undefined,
          emailDelivery: channels.email ? { status: 'pending' } : undefined,
          pushDelivery: channels.push ? { status: 'pending' } : undefined,
          inAppDelivery: channels.inApp ? { status: 'pending' } : undefined
        });
      });

      if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        console.log(`[notificationHelper] Inserted ${notifications.length} role-based notifications with userIds`);
        if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
          for (const n of notifications) {
            dispatchNotification(n, attachments);
          }
        }
        return notifications;
      }
      return [];
    }

    const notification = new Notification({
      type,
      channels,
      title,
      templateKey,
      templateVariables,
      content: renderedContent,
      metadata: { ...metadata },
      to,
      categoryId: category || undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      createdBy,
      source,
      smsDelivery: channels.sms ? { status: 'pending' } : undefined,
      emailDelivery: channels.email ? { status: 'pending' } : undefined,
      pushDelivery: channels.push ? { status: 'pending' } : undefined,
      inAppDelivery: channels.inApp ? { status: 'pending' } : undefined
    });

    await notification.save();
    console.log(`[notificationHelper] Saved notification for user: ${to.userId || 'none'}`);

    // If scheduled for now or past, dispatch immediately
    const now = new Date();
    if (!scheduledAt || new Date(scheduledAt) <= now) {
      await dispatchNotification(notification, attachments);
    }

    return notification;

  } catch (error) {
    console.error('Send notification error:', error);
    throw error;
  }
};

/**
 * Send a welcome notification to a new user
 */
export const sendWelcomeNotification = async (user, options = {}) => {
  return sendNotification({
    to: {
      email: user.email,
      phone: user.phone,
      userId: user._id
    },
    channels: { sms: !!user.phone, email: !!user.email },
    templateKey: 'welcome_mail',
    templateVariables: {
      memberName: user.name,
      companyName: options.companyName || 'Ofis Square',
      portalLink: options.portalLink || process.env.PORTAL_URL || 'https://portal.ofissquare.com'
    },
    title: 'Welcome to Ofis Square',
    metadata: {
      category: 'onboarding',
      tags: ['welcome', 'new_user']
    },
    source: 'system',
    type: 'transactional'
  });
};

/**
 * Send booking confirmation notification
 */
export const sendBookingConfirmation = async (booking, user, options = {}) => {
  return sendNotification({
    to: {
      email: user.email,
      phone: user.phone,
      userId: user._id
    },
    channels: { sms: !!user.phone, email: !!user.email },
    templateKey: 'booking_confirmation',
    templateVariables: {
      name: user.name,
      bookingId: booking._id || booking.id,
      date: options.date || new Date().toLocaleDateString(),
      time: options.time || new Date().toLocaleTimeString(),
      location: options.location || 'Ofis Square'
    },
    title: `Booking Confirmation - ${booking._id}`,
    metadata: {
      category: 'booking',
      tags: ['confirmation', 'booking'],
      relatedEntity: { entity: 'booking', entityId: booking._id }
    },
    source: 'system',
    type: 'transactional'
  });
};

/**
 * Send payment reminder notification
 */
export const sendPaymentReminder = async (invoice, user, options = {}) => {
  return sendNotification({
    to: {
      email: user.email,
      phone: user.phone,
      userId: user._id
    },
    channels: { sms: !!user.phone, email: !!user.email },
    templateKey: 'payment_reminder',
    templateVariables: {
      name: user.name,
      invoiceNumber: invoice.invoiceNumber || invoice._id,
      amount: invoice.totalAmount || invoice.amount,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'ASAP'
    },
    title: `Payment Reminder - ${invoice.invoiceNumber}`,
    metadata: {
      category: 'payment',
      tags: ['reminder', 'payment'],
      relatedEntity: { entity: 'invoice', entityId: invoice._id }
    },
    source: 'system',
    type: 'reminder'
  });
};

/**
 * Send OTP verification notification
 */
export const sendOTPNotification = async (phone, email, otp, options = {}) => {
  return sendNotification({
    to: { phone, email },
    channels: { sms: !!phone, email: !!email },
    templateKey: 'otp_verification',
    templateVariables: {
      otp,
      expiryMinutes: options.expiryMinutes || 10
    },
    title: 'OTP Verification',
    metadata: {
      category: 'security',
      tags: ['otp', 'verification']
    },
    source: 'system',
    type: 'transactional'
  });
};

/**
 * Send custom notification with simple content
 */
export const sendCustomNotification = async (recipient, message, options = {}) => {
  const { title, channels = { sms: true, email: false }, metadata = {} } = options;

  return sendNotification({
    to: recipient,
    channels,
    content: {
      smsText: message,
      emailSubject: title || 'Notification',
      emailHtml: `<p>${message}</p>`,
      emailText: message
    },
    title: title || 'Custom Notification',
    metadata: {
      category: 'custom',
      ...metadata
    },
    source: options.source || 'admin_panel',
    type: options.type || 'system'
  });
};

// Helper function to dispatch notification immediately
async function dispatchNotification(notification, attachments = []) {
  console.log(`[notificationHelper:dispatchNotification] Dispatching with ${attachments?.length || 0} attachments`);

  // Resolve attachments to Buffers if they are paths/URLs
  const resolvedAttachments = [];
  if (attachments && attachments.length > 0) {
    try {
      const axios = (await import('axios')).default;
      const fs = (await import('fs')).default;

      for (const att of attachments) {
        try {
          let content = att.content;
          if (!content && att.path) {
            if (att.path.startsWith('http')) {
              const response = await axios.get(att.path, { responseType: 'arraybuffer' });
              content = Buffer.from(response.data);
            } else {
              content = fs.readFileSync(att.path);
            }
          }

          if (content) {
            resolvedAttachments.push({
              ...att,
              content
            });
          }
        } catch (err) {
          console.error(`[notificationHelper] Failed to resolve attachment ${att.filename}:`, err.message);
        }
      }
    } catch (importErr) {
      console.error('[notificationHelper] Failed to import axios/fs for attachments:', importErr.message);
    }
  }

  const promises = [];

  // Dispatch SMS
  if (notification.channels.sms && notification.smsDelivery.status === 'pending') {
    promises.push(sendSMS(notification));
  }

  // Dispatch Email
  if (notification.channels.email && notification.emailDelivery.status === 'pending') {
    promises.push(sendEmail(notification, resolvedAttachments));
  }

  // Dispatch Push
  if (notification.channels.push && notification.pushDelivery.status === 'pending') {
    promises.push(sendPush(notification));
  }

  // Dispatch In-App
  if (notification.channels.inApp && notification.inAppDelivery.status === 'pending') {
    promises.push(sendInApp(notification));
  }

  console.log(`[notificationHelper:dispatchNotification] Awaiting ${promises.length} delivery promises for ID: ${notification._id}`);
  await Promise.allSettled(promises);
  await notification.save();
  console.log(`[notificationHelper:dispatchNotification] Saved notification ID: ${notification._id} with statuses: SMS=${notification.smsDelivery?.status}, Email=${notification.emailDelivery?.status}`);
}

// Helper function to send Push Notification
async function sendPush(notification) {
  try {
    let token = notification.to.pushToken;

    if (!token && notification.to.memberId) {
      const member = await Member.findById(notification.to.memberId).select('fcmTokens');
      if (member?.fcmTokens?.length) {
        token = member.fcmTokens[0];
      }
    }

    if (!token) {
      notification.updateDeliveryStatus('push', 'skipped', { details: 'No FCM token found' });
      return;
    }

    notification.updateDeliveryStatus('push', 'queued', { details: 'Sending Push' });

    const message = {
      notification: {
        title: notification.title,
        body: notification.content.smsText || notification.title,
      },
      data: {
        notificationId: notification._id.toString(),
        ...(notification.metadata || {})
      },
      token
    };

    if (admin.apps.length > 0) {
      const response = await admin.messaging().send(message);
      notification.updateDeliveryStatus('push', 'sent', {
        details: 'Push sent successfully',
        providerMessageId: response,
        providerResponse: { response }
      });
    } else {
      throw new Error('Firebase Admin not initialized');
    }

  } catch (error) {
    notification.updateDeliveryStatus('push', 'failed', {
      error: error.message,
      errorCode: 'PUSH_ERROR'
    });
  }
}

// Helper function to handle In-App Delivery
async function sendInApp(notification) {
  try {
    notification.updateDeliveryStatus('inApp', 'delivered', { details: 'Ready in portal' });
  } catch (error) {
    notification.updateDeliveryStatus('inApp', 'failed', {
      error: error.message,
      errorCode: 'INAPP_ERROR'
    });
  }
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
      errorCode: 'HELPER_ERROR'
    });
  }
}

// Helper function to send Email
async function sendEmail(notification, attachments = []) {
  try {
    console.log(`[notificationHelper:sendEmail] Sending email with ${attachments?.length || 0} attachments`);
    if (!notification.to.email) {
      throw new Error('Email address not provided');
    }

    notification.updateDeliveryStatus('email', 'queued', { details: 'Sending email' });
    notification.emailDelivery.provider = 'zeptomail';

    const result = await emailProvider.send({
      toEmail: notification.to.email,
      subject: notification.content.emailSubject,
      html: notification.content.emailHtml,
      text: notification.content.emailText,
      attachments: attachments || []
    });

    if (result.success) {
      console.log(`[notificationHelper:sendEmail] Email sent successfully to ${notification.to.email}`);
      notification.updateDeliveryStatus('email', 'sent', {
        details: 'Email sent successfully',
        providerMessageId: result.providerMessageId,
        providerResponse: result.providerResponse
      });
    } else {
      console.error(`[notificationHelper:sendEmail] Email failed for ${notification.to.email}:`, result.error);
      notification.updateDeliveryStatus('email', 'failed', {
        error: result.error,
        errorCode: result.errorCode,
        providerResponse: result.providerResponse
      });
    }

  } catch (error) {
    notification.updateDeliveryStatus('email', 'failed', {
      error: error.message,
      errorCode: 'HELPER_ERROR'
    });
  }
}
