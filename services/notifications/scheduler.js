import cron from 'node-cron';
import Notification from '../../models/notificationModel.js';
import { getSMSProvider } from './smsProvider.js';
import { getEmailProvider } from './emailProvider.js';

class NotificationScheduler {
  constructor() {
    this.smsProvider = getSMSProvider();
    this.emailProvider = getEmailProvider();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('Notification scheduler is already running');
      return;
    }

    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.processPendingNotifications();
    }, {
      scheduled: false
    });

    this.cronJob.start();
    this.isRunning = true;
    console.log('Notification scheduler started - checking every minute');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      console.log('Notification scheduler stopped');
    }
  }

  async processPendingNotifications() {
    try {
      const pendingNotifications = await Notification.findPendingScheduled();

      if (pendingNotifications.length === 0) {
        return;
      }

      console.log(`Processing ${pendingNotifications.length} pending notifications`);

      for (const notification of pendingNotifications) {
        await this.processNotification(notification);
      }
    } catch (error) {
      console.error('Error processing pending notifications:', error);
    }
  }

  async processNotification(notification) {
    try {
      // Check if notification has expired
      if (notification.expiresAt && new Date() > notification.expiresAt) {
        notification.canceled = true;
        notification.cancelReason = 'Expired';

        if (notification.channels.sms && notification.smsDelivery.status === 'pending') {
          notification.updateDeliveryStatus('sms', 'canceled', { details: 'Notification expired' });
        }

        if (notification.channels.email && notification.emailDelivery.status === 'pending') {
          notification.updateDeliveryStatus('email', 'canceled', { details: 'Notification expired' });
        }

        // Atomic update to avoid VersionError
        await Notification.updateOne(
          { _id: notification._id },
          {
            $set: {
              canceled: notification.canceled,
              cancelReason: notification.cancelReason,
              smsDelivery: notification.smsDelivery,
              emailDelivery: notification.emailDelivery
            }
          }
        );
        return;
      }

      const promises = [];

      // Process SMS if pending
      if (notification.channels.sms && notification.smsDelivery.status === 'pending') {
        promises.push(this.sendSMS(notification));
      }

      // Process Email if pending
      if (notification.channels.email && notification.emailDelivery.status === 'pending') {
        promises.push(this.sendEmail(notification));
      }

      await Promise.allSettled(promises);
      // Persist delivery updates atomically to avoid VersionError if the document was updated elsewhere
      await Notification.updateOne(
        { _id: notification._id },
        {
          $set: {
            smsDelivery: notification.smsDelivery,
            emailDelivery: notification.emailDelivery
          }
        }
      );

    } catch (error) {
      console.error(`Error processing notification ${notification._id}:`, error);
    }
  }

  async sendSMS(notification) {
    try {
      if (!notification.to.phone) {
        notification.updateDeliveryStatus('sms', 'failed', {
          error: 'Phone number not provided',
          errorCode: 'MISSING_PHONE'
        });
        return;
      }

      notification.updateDeliveryStatus('sms', 'queued', { details: 'Sending SMS via scheduler' });
      notification.smsDelivery.provider = 'smswaale';

      const result = await this.smsProvider.send({
        toPhone: notification.to.phone,
        text: notification.content.smsText
      });

      if (result.success) {
        notification.updateDeliveryStatus('sms', 'sent', {
          details: 'SMS sent successfully via scheduler',
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
        errorCode: 'SCHEDULER_ERROR'
      });
    }
  }

  async sendEmail(notification) {
    try {
      if (!notification.to.email) {
        notification.updateDeliveryStatus('email', 'failed', {
          error: 'Email address not provided',
          errorCode: 'MISSING_EMAIL'
        });
        return;
      }

      notification.updateDeliveryStatus('email', 'queued', { details: 'Sending email via scheduler' });
      notification.emailDelivery.provider = 'zeptomail';

      const result = await this.emailProvider.send({
        toEmail: notification.to.email,
        subject: notification.content.emailSubject,
        html: notification.content.emailHtml,
        text: notification.content.emailText
      });

      if (result.success) {
        notification.updateDeliveryStatus('email', 'sent', {
          details: 'Email sent successfully via scheduler',
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
        errorCode: 'SCHEDULER_ERROR'
      });
    }
  }

  async retryFailedNotifications() {
    try {
      const failedNotifications = await Notification.find({
        $or: [
          {
            'channels.sms': true,
            'smsDelivery.status': 'failed',
            'smsDelivery.attemptCount': { $lt: 3 }
          },
          {
            'channels.email': true,
            'emailDelivery.status': 'failed',
            'emailDelivery.attemptCount': { $lt: 3 }
          }
        ],
        canceled: false
      });

      console.log(`Retrying ${failedNotifications.length} failed notifications`);

      for (const notification of failedNotifications) {
        // Reset failed channels to pending for retry
        if (notification.channels.sms &&
          notification.smsDelivery.status === 'failed' &&
          notification.canRetry('sms')) {
          notification.updateDeliveryStatus('sms', 'pending', { details: 'Automatic retry' });
          notification.incrementAttempt('sms');
        }

        if (notification.channels.email &&
          notification.emailDelivery.status === 'failed' &&
          notification.canRetry('email')) {
          notification.updateDeliveryStatus('email', 'pending', { details: 'Automatic retry' });
          notification.incrementAttempt('email');
        }

        await notification.save();
        await this.processNotification(notification);
      }
    } catch (error) {
      console.error('Error retrying failed notifications:', error);
    }
  }
}

// Singleton instance
const scheduler = new NotificationScheduler();

export default scheduler;
export { NotificationScheduler };
