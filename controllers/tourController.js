import TourSlot from "../models/tourSlotModel.js";
import TourBooking from "../models/tourBookingModel.js";
import Lead from "../models/leadModel.js";
import mongoose from "mongoose";

// Get available slots by city
export const getAvailableSlots = async (req, res) => {
    try {
        const { cityId } = req.params;
        const { date } = req.query;

        if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) {
            return res.status(400).json({ message: "Invalid city ID" });
        }

        const filter = {
            city: cityId,
            isAvailable: true
        };

        if (date) {
            const searchDate = new Date(date);
            const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0));
            const endOfDay = new Date(searchDate.setHours(23, 59, 59, 999));
            filter.date = { $gte: startOfDay, $lte: endOfDay };
        } else {
            // Default to future slots from today
            filter.date = { $gte: new Date().setHours(0, 0, 0, 0) };
        }

        const slots = await TourSlot.find(filter).sort({ date: 1, timeSlot: 1 });

        res.json({ slots });
    } catch (error) {
        console.error("Error fetching tour slots:", error);
        res.status(500).json({ message: "Failed to fetch tour slots", error: error.message });
    }
};

// Book a tour
export const bookTour = async (req, res) => {
    try {
        const { leadId, slotId, notes } = req.body;

        if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
            return res.status(400).json({ message: "Invalid lead ID" });
        }
        if (!slotId || !mongoose.Types.ObjectId.isValid(slotId)) {
            return res.status(400).json({ message: "Invalid slot ID" });
        }

        // Check if slot exists and is available
        const slot = await TourSlot.findById(slotId);
        if (!slot) {
            return res.status(404).json({ message: "Tour slot not found" });
        }
        if (!slot.isAvailable) {
            return res.status(400).json({ message: "Tour slot is no longer available" });
        }

        // Check if lead exists
        const lead = await Lead.findById(leadId);
        if (!lead) {
            return res.status(404).json({ message: "Lead not found" });
        }

        // Create booking
        const booking = new TourBooking({
            lead: leadId,
            slot: slotId,
            notes
        });

        await booking.save();

        // Mark slot as unavailable (optional, depends on requirement)
        // For now, let's assume one slot can only have one booking
        slot.isAvailable = false;
        await slot.save();

        res.status(201).json({
            message: "Tour booked successfully",
            booking
        });
    } catch (error) {
        console.error("Error booking tour:", error);
        res.status(500).json({ message: "Failed to book tour", error: error.message });
    }
};

// Create a tour slot (Admin/Staff)
export const createTourSlot = async (req, res) => {
    try {
        const { city, date, timeSlot } = req.body;

        if (!city || !date || !timeSlot) {
            return res.status(400).json({ message: "City, date, and timeSlot are required" });
        }

        const slot = new TourSlot({
            city,
            date,
            timeSlot
        });

        await slot.save();

        res.status(201).json({
            message: "Tour slot created successfully",
            slot
        });
    } catch (error) {
        console.error("Error creating tour slot:", error);
        res.status(500).json({ message: "Failed to create tour slot", error: error.message });
    }
};
