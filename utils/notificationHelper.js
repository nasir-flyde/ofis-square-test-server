import Notification from '../models/notificationModel.js';
import { getSMSProvider } from '../services/notifications/smsProvider.js';
import { getEmailProvider } from '../services/notifications/emailProvider.js';
import renderer from '../services/notifications/renderer.js';

const smsProvider = getSMSProvider();
const emailProvider = getEmailProvider();

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
      channels,
      templateKey,
      templateVariables,
      content,
      title,
      metadata = {},
      createdBy,
      source = 'system',
      scheduledAt,
      type = 'system'
    } = options;

    // Validate required fields
    if (!channels || (!channels.sms && !channels.email)) {
      throw new Error('At least one channel must be enabled');
    }

    if (!to || (!to.phone && !to.email && !to.userId && !to.memberId && !to.clientId)) {
      throw new Error('At least one recipient identifier must be provided');
    }

    if (!title) {
      throw new Error('Title is required');
    }

    // Render content
    let renderedContent = {};
    if (templateKey) {
      const templateContent = renderer.renderTemplate(templateKey, templateVariables || {});
      renderedContent = {
        smsText: templateContent.sms,
        emailSubject: templateContent.subject,
        emailHtml: templateContent.html,
        emailText: templateContent.text
      };
    } else if (content) {
      renderedContent = renderer.renderContent(content, templateVariables || {});
    } else {
      throw new Error('Either templateKey or content must be provided');
    }

    // Create notification
    const notification = new Notification({
      type,
      channels,
      title,
      templateKey,
      templateVariables,
      content: renderedContent,
      metadata,
      to,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      createdBy,
      source,
      smsDelivery: channels.sms ? { status: 'pending' } : undefined,
      emailDelivery: channels.email ? { status: 'pending' } : undefined
    });

    await notification.save();

    // If scheduled for now or past, dispatch immediately
    const now = new Date();
    if (!scheduledAt || new Date(scheduledAt) <= now) {
      await dispatchNotification(notification);
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
    templateKey: 'welcome_email',
    templateVariables: {
      name: user.name,
      companyName: options.companyName || 'Ofis Square'
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
      errorCode: 'HELPER_ERROR'
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
      errorCode: 'HELPER_ERROR'
    });
  }
}
