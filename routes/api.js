import express from "express";
import authRoutes from "./auth.js";
import roleRoutes from "./roles.js";
import healthRoutes from "./health.js";
import clientRoutes from "./clients.js";
import contractRoutes from "./contracts.js";
import invoiceRoutes from "./invoices.js";
import buildingsRoutes from "./buildings.js";
import cabinsRoutes from "./cabins.js";
import desksRoutes from "./desks.js";
import paymentsRoutes from "./payments.js";
import draftPaymentsRoutes from "./draftPayments.js";
import meetingRoomsRoutes from "./meetingRooms.js";
import meetingBookingsRoutes from "./meetingBookings.js";
import dayPassesRoutes from "./dayPasses.js";
import visitorsRoutes from "./visitors.js";
import ticketsRoutes from "./tickets.js";
import meRoutes from "./me.js";
import ticketCategoriesRoutes from "./ticketCategories.js";
import walletRoutes from "./wallet.js";
import memberRoutes from "./members.js";
import memberPortalRoutes from "./memberPortal.js";
import userRoutes from "./users.js";
<<<<<<< Updated upstream
=======
import communityRoutes from "./community.js";
import webhookRoutes from "./webhooks.js";
import creditRoutes from "./credits.js";
import activityLogsRoutes from "./activityLogs.js";
import apiLogsRoutes from "./apiLogs.js";
import eventsRoutes from "./events.js";
import eventCategoriesRoutes from "./eventCategories.js";
import leadsRoutes from "./leads.js";
import notificationsRoutes from "./notifications.js";
import announcementsRoutes from "./announcements.js";

>>>>>>> Stashed changes

const router = express.Router();

// Modular routes (mirroring ezstays-backend style)
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/me", meRoutes);
router.use("/roles", roleRoutes);
router.use("/clients", clientRoutes);
router.use("/contracts", contractRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/buildings", buildingsRoutes);
router.use("/cabins", cabinsRoutes);
router.use("/desks", desksRoutes);
router.use("/payments", paymentsRoutes);
router.use("/draft-payments", draftPaymentsRoutes);
router.use("/meeting-rooms", meetingRoomsRoutes);
router.use("/meeting-bookings", meetingBookingsRoutes);
router.use("/day-passes", dayPassesRoutes);
router.use("/visitors", visitorsRoutes);
router.use("/tickets", ticketsRoutes);
router.use("/ticket-categories", ticketCategoriesRoutes);
router.use("/wallet", walletRoutes);
router.use("/members", memberRoutes);
router.use("/member-portal", memberPortalRoutes);
router.use("/users", userRoutes);
<<<<<<< Updated upstream

=======
router.use("/community", communityRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/credits", creditRoutes);
router.use("/activity-logs", activityLogsRoutes);
router.use("/api-logs", apiLogsRoutes);
router.use("/events", eventsRoutes);
router.use("/event-categories", eventCategoriesRoutes);
router.use("/leads", leadsRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/announcements", announcementsRoutes);
>>>>>>> Stashed changes
export default router;
