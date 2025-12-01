import cron from 'node-cron';
import { markNoShows } from '../controllers/visitorController.js';
import { createMonthlyInvoices } from '../services/monthlyInvoiceService.js';
import { getValidAccessToken } from './zohoTokenManager.js';

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
  cron.schedule('0 2 1 * *', async () => {
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
  
  console.log('Monthly invoice generation cron job scheduled for 1st of every month at 2 AM');
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


export { scheduleNoShowUpdates, scheduleMonthlyInvoices, scheduleZohoTokenRefresh };
