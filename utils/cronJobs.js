import cron from 'node-cron';
import { markNoShows } from '../controllers/visitorController.js';
import { createMonthlyInvoices, createMonthlyEstimates, createMonthlyEstimatesConsolidated } from '../services/monthlyInvoiceService.js';
import { getValidAccessToken } from './zohoTokenManager.js';
import AccessGrant from '../models/accessGrantModel.js';
import { enforceAccessByInvoices } from '../services/accessService.js';
import { processPaymentReminders } from '../controllers/invoiceController.js';

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

const scheduleMonthlyInvoices = () => {
  // Run daily; per-building logic inside the service decides whether today is the generation day
  cron.schedule('44 18 * * *', async () => {
    try {
      const mode = process.env.BILLING_MODE === 'estimate' ? 'estimate' : 'invoice';
      console.log(`Running monthly ${mode} generation job...`);
      const result = mode === 'estimate' ? await createMonthlyEstimatesConsolidated() : await createMonthlyInvoices();
      if (mode === 'estimate') {
        console.log(`Monthly estimate generation completed. Created ${result.created} estimates, skipped ${result.skipped}, ${result.errors} errors.`);
        // Detailed skip breakdown for estimates
        if (result && Array.isArray(result.details) && result.details.length > 0) {
          try {
            const breakdown = {};
            for (const d of result.details) {
              if (d && (d.status === 'skipped' || d.status === 'exists')) {
                const reason = d.reason || d.status || 'unknown';
                breakdown[reason] = (breakdown[reason] || 0) + 1;
              }
            }
            console.log('[Monthly Estimates] Skip breakdown by reason:', breakdown);

            const samples = result.details
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
        console.log(`Monthly invoice generation completed. Created ${result.created} invoices, ${result.errors} errors.`);
      }
    } catch (error) {
      console.error('Error in monthly invoice generation job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  console.log('Monthly billing cron job scheduled daily (IST)');
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

export { scheduleNoShowUpdates, scheduleMonthlyInvoices, scheduleZohoTokenRefresh, scheduleAccessEnforcement, schedulePaymentReminders };
