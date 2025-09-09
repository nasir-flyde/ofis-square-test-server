import cron from 'node-cron';
import { markNoShows } from '../controllers/visitorController.js';

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

export { scheduleNoShowUpdates };
