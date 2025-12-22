import cron from 'node-cron';
import { markNoShows } from '../controllers/visitorController.js';
import { createMonthlyInvoices } from '../services/monthlyInvoiceService.js';
import { getValidAccessToken } from './zohoTokenManager.js';
import AccessGrant from '../models/accessGrantModel.js';
import { enforceAccessByInvoices } from '../services/accessService.js';

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
  cron.schedule('21 17 * * *', async () => {
    try {
      console.log('Running monthly invoice generation job...');
      const result = await createMonthlyInvoices();
      console.log(`Monthly invoice generation completed. Created ${result.created} invoices, ${result.errors} errors.`);
    } catch (error) {
      console.error('Error in monthly invoice generation job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  console.log('Monthly invoice generation cron job scheduled daily at 12:02 AM (IST)');
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

export { scheduleNoShowUpdates, scheduleMonthlyInvoices, scheduleZohoTokenRefresh, scheduleAccessEnforcement };
