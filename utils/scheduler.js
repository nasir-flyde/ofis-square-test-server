import cron from "node-cron";
import { runPreviousMonthConsolidation } from "../services/creditConsolidationService.js";

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduler() {
  console.log("🕐 Initializing scheduler...");

  // Monthly credit invoice generation
  // Runs at 00:30 on the 1st of every month
  const monthlyInvoiceJob = cron.schedule("30 0 1 * *", async () => {
    console.log("🔄 Starting scheduled monthly credit consolidation...");
    
    try {
      const results = await runPreviousMonthConsolidation();
      
      console.log("✅ Scheduled credit consolidation completed:");
      console.log(`   • Clients processed: ${results.processed}`);
      console.log(`   • Invoices created: ${results.invoices_created}`);
      console.log(`   • Invoices skipped: ${results.invoices_skipped}`);
      console.log(`   • Errors: ${results.errors.length}`);
      
      if (results.errors.length > 0) {
        console.error("❌ Consolidation errors:", results.errors);
      }
      
      // Log summary for each client
      results.summary.forEach(client => {
        if (client.status === "invoice_created") {
          console.log(`💰 ${client.client}: ₹${client.invoice_amount} (${client.extra_credits} extra credits)`);
        }
      });
      
    } catch (error) {
      console.error("❌ Scheduled credit consolidation failed:", error.message);
      console.error(error.stack);
    }
  }, {
    scheduled: false, // Don't start immediately
    timezone: "Asia/Kolkata" // Indian Standard Time
  });

  // Start the job
  monthlyInvoiceJob.start();
  console.log("✅ Monthly credit invoice job scheduled (1st of every month at 00:30 IST)");

  // Optional: Add other scheduled jobs here
  // Example: Weekly credit alerts
  const weeklyAlertsJob = cron.schedule("0 9 * * 1", async () => {
    console.log("📊 Running weekly credit alerts check...");
    
    try {
      const { getClientsWithCreditAlerts } = await import("./creditMonitoring.js");
      const alerts = await getClientsWithCreditAlerts();
      
      if (alerts.length > 0) {
        console.log(`⚠️  ${alerts.length} clients have credit alerts:`);
        alerts.forEach(alert => {
          console.log(`   • ${alert.client.name}: ${alert.usage.percentage.toFixed(1)}% usage (${alert.alert_level.level})`);
        });
      } else {
        console.log("✅ No credit alerts this week");
      }
      
    } catch (error) {
      console.error("❌ Weekly credit alerts failed:", error.message);
    }
  }, {
    scheduled: false,
    timezone: "Asia/Kolkata"
  });

  weeklyAlertsJob.start();
  console.log("✅ Weekly credit alerts job scheduled (Mondays at 09:00 IST)");

  return {
    monthlyInvoiceJob,
    weeklyAlertsJob,
    
    // Utility methods
    stopAll: () => {
      monthlyInvoiceJob.stop();
      weeklyAlertsJob.stop();
      console.log("🛑 All scheduled jobs stopped");
    },
    
    startAll: () => {
      monthlyInvoiceJob.start();
      weeklyAlertsJob.start();
      console.log("▶️  All scheduled jobs started");
    },
    
    getStatus: () => {
      return {
        monthlyInvoice: {
          running: monthlyInvoiceJob.running,
          nextRun: monthlyInvoiceJob.nextDate()?.toISO(),
          schedule: "30 0 1 * *" // 00:30 on 1st of every month
        },
        weeklyAlerts: {
          running: weeklyAlertsJob.running,
          nextRun: weeklyAlertsJob.nextDate()?.toISO(),
          schedule: "0 9 * * 1" // 09:00 every Monday
        }
      };
    }
  };
}

// Manual trigger functions (for testing)
export async function triggerMonthlyConsolidation() {
  console.log("🔄 Manually triggering monthly credit consolidation...");
  
  try {
    const results = await runPreviousMonthConsolidation();
    console.log("✅ Manual consolidation completed:", results);
    return results;
  } catch (error) {
    console.error("❌ Manual consolidation failed:", error);
    throw error;
  }
}

export default {
  initializeScheduler,
  triggerMonthlyConsolidation
};
