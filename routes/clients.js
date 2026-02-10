import express from "express";
import clientMiddleware from "../middlewares/clientMiddleware.js";
import { kycUploads } from "../middlewares/multer.js";
import {
  createClient,
  upsertBasicDetails,
  updateCommercialDetails,
  updateAddressDetails,
  updateContactPersons,
  updateTaxDetails,
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
  approveClientContract,
  submitClientContractFeedback,
  getClientLegalUsers,
  getClientTickets,
  createClientTicket,
  getClientMembers,
  createClientMember,
  updateClientMember,
  deleteClientMember,
  getClientRfidCards,
  getClientAvailableDesks,
  allocateDeskToMember,
  getClientDashboard,
  releaseDeskFromMember,
  getClientCreditManagement,
  getCurrentClientProfile,
  updateCurrentClientProfile,
  getOnboardingStatus,
  approveOnboarding,
  sendContractToLegalTeam
} from "../controllers/clientController.js";
import { getClientPayments } from "../controllers/paymentController.js";
import authMiddleware from "../middlewares/authVerify.js";

const router = express.Router();

router.post("/", kycUploads, createClient);

router.post("/basic-details", authMiddleware, upsertBasicDetails);

// New section-specific update routes
router.put("/:id/commercial", authMiddleware, updateCommercialDetails);
router.put("/:id/addresses", authMiddleware, updateAddressDetails);
router.put("/:id/contacts", authMiddleware, updateContactPersons);
router.put("/:id/tax", authMiddleware, updateTaxDetails);

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
router.post("/contracts/:id/approve", clientMiddleware, approveClientContract);
router.post("/contracts/:id/feedback", clientMiddleware, kycUploads, submitClientContractFeedback);
router.post("/contracts/:id/send-to-legal-team", clientMiddleware, sendContractToLegalTeam);
router.get("/legal-users", clientMiddleware, getClientLegalUsers);
router.get("/tickets", clientMiddleware, getClientTickets);
router.post("/tickets", clientMiddleware, kycUploads, createClientTicket);

router.get("/members", clientMiddleware, getClientMembers);
router.post("/members", clientMiddleware, createClientMember);
router.put("/members/:id", clientMiddleware, updateClientMember);
router.delete("/members/:id", clientMiddleware, deleteClientMember);
router.get("/rfid-cards", clientMiddleware, getClientRfidCards);

router.get("/desks", clientMiddleware, getClientAvailableDesks); // Desk allocation
router.post('/desks/allocate', clientMiddleware, allocateDeskToMember);
router.post('/desks/release', clientMiddleware, releaseDeskFromMember);

router.get("/", getClients);
router.get("/:id", getClientById);
router.put("/:id", updateClient);
router.delete("/:id", deleteClient);
router.post("/:id/kyc", authMiddleware, kycUploads, submitKycDocuments);
router.post("/:id/kyc/verify", authMiddleware, verifyKyc);
router.post("/:id/kyc/reject", authMiddleware, rejectKyc);

// Onboarding status and approval
router.get("/:id/onboarding-status", authMiddleware, getOnboardingStatus);
router.post("/:id/approve-onboarding", authMiddleware, approveOnboarding);

export default router;
