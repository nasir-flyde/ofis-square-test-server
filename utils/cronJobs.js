import cron from 'node-cron';
import { markNoShows } from '../controllers/visitorController.js';
import {
  createMonthlyInvoices,
  createMonthlyEstimatesConsolidated,
  processApprovedEstimatesForSending,
  convertSentEstimatesToInvoices
} from '../services/monthlyInvoiceService.js';
import { recordDailyLateFees, generateMonthlyLateFeeEstimates } from '../services/lateFeeService.js';
import { getValidAccessToken } from './zohoTokenManager.js';
import AccessGrant from '../models/accessGrantModel.js';
import { enforceAccessByInvoices } from '../services/accessService.js';
import { processPaymentReminders } from '../controllers/invoiceController.js';
import { refreshAccessToken } from './gstTokenManager.js';

const scheduleNoShowUpdates = () => {
  cron.schedule('0 1 * * *', async () => {
    try {
      console.log('Running daily no-show update job...');
      const count = await markNoShows();
      console.log(`No-show update completed. Marked ${count} visitors as no-show.`);
    } catch (error) {
      console.error('Error in no-show update job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('No-show update cron job scheduled for 1 AM daily');
};

const scheduleLateFeeJobs = () => {
  // Run daily at 00:05 AM IST
  cron.schedule('5 0 * * *', async () => {
    try {
      console.log('Running daily late fee recording job...');
      await recordDailyLateFees();
    } catch (error) {
      console.error('Error in daily late fee recording job:', error);
    }
  }, { scheduled: true, timezone: "Asia/Kolkata" });

  // Run daily at 01:00 AM IST to check if we need to generate monthly estimates
  cron.schedule('0 1 * * *', async () => {
    try {
      console.log('Running monthly late fee estimate generation check...');
      await generateMonthlyLateFeeEstimates();
    } catch (error) {
      console.error('Error in monthly late fee estimate generation job:', error);
    }
  }, { scheduled: true, timezone: "Asia/Kolkata" });

  console.log('Daily Late Fee jobs scheduled (Record: 00:05, Generate: 01:00)');
};

const scheduleMonthlyInvoices = () => {
  // Run daily; per-building logic inside the service decides whether today is the generation day
  cron.schedule('40 17 * * *', async () => {
    try {
      const mode = process.env.BILLING_MODE === 'estimate' ? 'estimate' : 'invoice';
      console.log(`[Billing Pipeline] Running daily maintenance job... (Mode: ${mode})`);

      // Stage 1: Draft Generation (default 22nd)
      const genResult = mode === 'estimate'
        ? await createMonthlyEstimatesConsolidated()
        : await createMonthlyInvoices();

      if (mode === 'estimate') {
        console.log(`[Billing Stage 1] Estimate generation completed. Created: ${genResult.created}, Skipped: ${genResult.skipped}, Errors: ${genResult.errors}`);
        // Detailed skip breakdown for estimates
        if (genResult && Array.isArray(genResult.details) && genResult.details.length > 0) {
          try {
            const breakdown = {};
            for (const d of genResult.details) {
              if (d && (d.status === 'skipped' || d.status === 'exists')) {
                const reason = d.reason || d.status || 'unknown';
                breakdown[reason] = (breakdown[reason] || 0) + 1;
              }
            }
            console.log('[Monthly Estimates] Skip breakdown by reason:', breakdown);

            const samples = genResult.details
              .filter(d => d && (d.status === 'skipped' || d.status === 'exists'))
              .slice(0, 10)
              .map(d => ({
                group: d.group || d.contractId,
                status: d.status,
                reason: d.reason,
                estimateId: d.estimateId
              }));
            if (samples.length) {
              console.log('[Monthly Estimates] Sample skipped groups/contracts:', samples);
            }
          } catch (e) {
            console.warn('Failed to log monthly estimate skip breakdown:', e?.message || e);
          }
        }
      } else {
        console.log(`[Billing Stage 1] Invoice generation completed. Created: ${genResult.created}, Errors: ${genResult.errors}`);
      }

      // Stage 3: Auto-Send Approved Estimates (default 26th)
      const sendResult = await processApprovedEstimatesForSending();
      console.log(`[Billing Stage 3] Estimate sending completed. Sent: ${sendResult.sent}, Errors: ${sendResult.errors}`);

      // Stage 4: Auto-Convert to Invoices (default 1st)
      const convResult = await convertSentEstimatesToInvoices();
      console.log(`[Billing Stage 4] Invoice conversion completed. Converted: ${convResult.converted}, Errors: ${convResult.errors}`);

    } catch (error) {
      console.error('Error in monthly billing generation job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('Monthly billing pipeline cron job scheduled daily (IST)');
};

const scheduleZohoTokenRefresh = () => {
  // Every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      console.log('Running Zoho token refresh job...');
      const token = await getValidAccessToken();
      const masked = token ? `${String(token).slice(0, 8)}...` : 'none';
      console.log(`Zoho token check complete. Current token: ${masked}`);
    } catch (error) {
      console.error('Error in Zoho token refresh job:', error?.message || error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('Zoho token refresh cron job scheduled for every 10 minutes');
};
const scheduleAccessEnforcement = () => {
  // Run every 2 minutes
  cron.schedule('*/3600 * * * *', async () => {
    try {
      console.log('Running hourly access enforcement job...');
      const clientIds = await AccessGrant.distinct('clientId', {});
      let processed = 0;
      let suspended = 0;
      let resumed = 0;
      for (const clientId of clientIds) {
        if (!clientId) continue;
        const result = await enforceAccessByInvoices(clientId);
        processed += 1;
        if (result?.action === 'suspended') suspended += (result.modified || 0);
        if (result?.action === 'resumed') resumed += (result.modified || 0);
      }
      console.log(`Access enforcement completed. Clients processed: ${processed}, Grants suspended: ${suspended}, Grants resumed: ${resumed}`);
    } catch (error) {
      console.error('Error in hourly access enforcement job:', error?.message || error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('Hourly access enforcement cron job scheduled for minute 0 of every hour');
};

const schedulePaymentReminders = () => {
  // Run daily at 10:00 AM IST
  cron.schedule('0 10 * * *', async () => {
    try {
      console.log('Running daily payment reminder job...');
      const result = await processPaymentReminders();
      console.log(`Payment reminders completed: ${result.sent}/${result.processed} reminders sent.`);
    } catch (error) {
      console.error('Error in payment reminder job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('Payment reminder cron job scheduled for 10 AM daily (IST)');
};

const scheduleGstTokenRefresh = () => {
  // Run daily at 00:00 AM IST
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Running daily GST token refresh job...');
      await refreshAccessToken();
    } catch (error) {
      console.error('Error in daily GST token refresh job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('GST token refresh cron job scheduled for 00:00 AM daily (IST)');
};

const scheduleMeetingBookingCleanup = () => {
  cron.schedule('*/2 * * * *', async () => {
    try {
      // Lazy load to avoid circular dependencies if any
      const MeetingBooking = (await import('../models/meetingBookingModel.js')).default;
      const MeetingRoom = (await import('../models/meetingRoomModel.js')).default;
      const { buildingMap } = await import('./cache.js');

      const pendingBookings = await MeetingBooking.find({ status: 'payment_pending' })
        .populate({ path: 'room', select: 'building' })
        .lean();

      if (!pendingBookings.length) return;

      const now = new Date();
      const expiredIds = [];

      for (const b of pendingBookings) {
        if (!b.room || !b.room.building) continue;
        const bldgId = b.room.building.toString();
        const bldg = buildingMap.get(bldgId);
        const timeout = bldg?.meetingPaymentPendingTimeoutMinutes ?? 10;
        const expiryTime = new Date(new Date(b.createdAt).getTime() + timeout * 60000);

        if (now > expiryTime) {
          expiredIds.push(b._id);
        }
      }

      if (expiredIds.length > 0) {
        await MeetingBooking.updateMany(
          { _id: { $in: expiredIds } },
          { $set: { status: 'cancelled' } }
        );
        console.log(`[cronJobs] Auto-cancelled ${expiredIds.length} expired payment-pending bookings`);
      }
    } catch (error) {
      console.error('Error in meeting booking cleanup cron job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('Meeting booking cleanup cron job scheduled for every 2 minutes');
};

export {
  scheduleNoShowUpdates,
  scheduleMonthlyInvoices,
  scheduleZohoTokenRefresh,
  scheduleAccessEnforcement,
  schedulePaymentReminders,
  scheduleLateFeeJobs,
  scheduleGstTokenRefresh,
  scheduleMeetingBookingCleanup
};
