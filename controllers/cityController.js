import City from "../models/cityModel.js";
import { logCRUDActivity } from "../utils/activityLogger.js";

export const createCity = async (req, res) => {
    try {
        const { name, state, country, isActive } = req.body;

        if (!name || !state) {
            return res.status(400).json({ success: false, message: "Name and state are required" });
        }

        const city = await City.create({ name, state, country, isActive });

        await logCRUDActivity(req, 'CREATE', 'City', city._id, null, { name, state });

        res.status(201).json({ success: true, data: city });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getCities = async (req, res) => {
    try {
        const { isActive } = req.query;
        const filter = {};
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        const cities = await City.find(filter).sort({ name: 1 });
        res.json({ success: true, data: cities });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getCityById = async (req, res) => {
    try {
        const city = await City.findById(req.params.id);
        if (!city) {
            return res.status(404).json({ success: false, message: "City not found" });
        }
        res.json({ success: true, data: city });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateCity = async (req, res) => {
    try {
        const { name, state, country, isActive } = req.body;
        const oldCity = await City.findById(req.params.id);

        if (!oldCity) {
            return res.status(404).json({ success: false, message: "City not found" });
        }

        const city = await City.findByIdAndUpdate(
            req.params.id,
            { name, state, country, isActive },
            { new: true, runValidators: true }
        );

        await logCRUDActivity(req, 'UPDATE', 'City', city._id, { before: oldCity.toObject(), after: city.toObject() }, { name, state });

        res.json({ success: true, data: city });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteCity = async (req, res) => {
    try {
        const city = await City.findByIdAndDelete(req.params.id);
        if (!city) {
            return res.status(404).json({ success: false, message: "City not found" });
        }

        await logCRUDActivity(req, 'DELETE', 'City', city._id, null, { name: city.name });

        res.json({ success: true, message: "City deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
