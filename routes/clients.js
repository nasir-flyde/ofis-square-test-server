import express from "express";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import { kycUploads } from "../middlewares/multer.js";
import {
  createClient,
  upsertBasicDetails,
  getClients,
  getClientById,
  updateClient,
  deleteClient,
  submitKycDocuments,
  verifyKyc,
  rejectKyc,
  getClientProfile,
  getClientBookings,
  getClientInvoices,
  getClientContracts,
  getClientTickets,
  createClientTicket,
  getClientMembers,
  createClientMember,
  updateClientMember,
  deleteClientMember,
  getClientAvailableDesks,
  allocateDeskToMember,
  getClientDashboard,
  releaseDeskFromMember,
  getClientCreditManagement,
  getCurrentClientProfile,
  updateCurrentClientProfile
} from "../controllers/clientController.js";
import { getClientPayments } from "../controllers/paymentController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", authMiddleware, createClient);

router.post("/basic-details", authMiddleware, upsertBasicDetails);

router.get("/dashboard", clientMiddleware, getClientDashboard);
router.get("/profile", clientMiddleware, getClientProfile);
router.get("/credits", clientMiddleware, getClientCreditManagement);

// Settings page endpoints
router.get("/me", clientMiddleware, getCurrentClientProfile);
router.put("/me", clientMiddleware, updateCurrentClientProfile);

router.get("/bookings", clientMiddleware, getClientBookings);
router.get("/invoices", clientMiddleware, getClientInvoices);
router.get("/payments", clientMiddleware, getClientPayments);
router.get("/contracts", clientMiddleware, getClientContracts);
router.get("/tickets", clientMiddleware, getClientTickets);
router.post("/tickets", clientMiddleware, createClientTicket);

router.get("/members", clientMiddleware, getClientMembers);
router.post("/members", clientMiddleware, createClientMember);
router.put("/members/:id", clientMiddleware, updateClientMember);
router.delete("/members/:id", clientMiddleware, deleteClientMember);

router.get("/desks", clientMiddleware, getClientAvailableDesks); // Desk allocation
router.post('/desks/allocate', clientMiddleware, allocateDeskToMember);
router.post('/desks/release', clientMiddleware, releaseDeskFromMember);

router.get("/", getClients);
router.get("/:id", getClientById);
router.put("/:id", updateClient);
router.delete("/:id", deleteClient);
router.post("/:id/kyc",authMiddleware, kycUploads, submitKycDocuments);
router.post("/:id/kyc/verify",authMiddleware, verifyKyc);
router.post("/:id/kyc/reject", authMiddleware, rejectKyc);

export default router;
