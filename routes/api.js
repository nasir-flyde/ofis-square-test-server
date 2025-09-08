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
import meetingRoomsRoutes from "./meetingRooms.js";
import meetingBookingsRoutes from "./meetingBookings.js";
import dayPassesRoutes from "./dayPasses.js";
import ticketsRoutes from "./tickets.js";
import meRoutes from "./me.js";
import ticketCategoriesRoutes from "./ticketCategories.js";
import walletRoutes from "./wallet.js";
import memberRoutes from "./members.js";
import userRoutes from "./users.js";

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
router.use("/meeting-rooms", meetingRoomsRoutes);
router.use("/meeting-bookings", meetingBookingsRoutes);
router.use("/day-passes", dayPassesRoutes);
router.use("/tickets", ticketsRoutes);
router.use("/ticket-categories", ticketCategoriesRoutes);
router.use("/wallet", walletRoutes);
router.use("/members", memberRoutes);
router.use("/users", userRoutes);

export default router;
