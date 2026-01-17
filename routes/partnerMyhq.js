import express from "express";
import partnerAuth from "../middlewares/partnerAuth.js";
import {
  issueToken,
  listCenters,
  listRoomsInCenter,
  bulkAvailabilities,
  bookRoom,
  getBookingDetails,
  cancelBooking,
  listDayPassBuildings,
  buildingDayPassAvailability,
  bookDayPass,
  cancelDayPassBooking,
} from "../controllers/partnerMyhqController.js";

const router = express.Router();

// Public: token issuance for myHQ
router.post("/auth/token", issueToken);

// Authenticated partner routes
router.use(partnerAuth("myhq"));

// Centers and rooms
router.get("/centers", listCenters);
router.get("/centers/:centerId/meeting-rooms", listRoomsInCenter);

// Availability
router.post("/meeting-rooms/availabilities", bulkAvailabilities);

// Booking lifecycle
router.post("/meeting-room/booking", bookRoom);
router.get("/meeting-room/booking/:id", getBookingDetails);
router.delete("/meeting-room/booking/:id", cancelBooking);

// Day Pass: buildings and building-level availability
router.get("/building/list", listDayPassBuildings); // expects ?product=daypass
router.post("/building/:buildingId/daypass/availability", buildingDayPassAvailability);

// Day Pass: booking lifecycle
router.post("/daypass/booking", bookDayPass);
router.delete("/daypass/booking/:id", cancelDayPassBooking);

export default router;
