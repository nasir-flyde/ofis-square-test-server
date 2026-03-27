import TermsAndConditions from "../models/termsAndConditionsModel.js";
import { logCRUDActivity } from "../utils/activityLogger.js";

export const createTermsAndConditions = async (req, res) => {
    try {
        const { title, paragraphs } = req.body;

        if (!title || !Array.isArray(paragraphs) || paragraphs.length === 0) {
            return res.status(400).json({ success: false, message: "Title and paragraphs array are required" });
        }

        const termsAndConditions = await TermsAndConditions.create({ title, paragraphs });

        await logCRUDActivity(req, 'CREATE', 'TermsAndConditions', termsAndConditions._id, null, { title });

        res.status(201).json({ success: true, data: termsAndConditions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getTermsAndConditions = async (req, res) => {
    try {
        const termsAndConditions = await TermsAndConditions.find().sort({ createdAt: -1 });
        res.json({ success: true, data: termsAndConditions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getTermsAndConditionsById = async (req, res) => {
    try {
        const termsAndConditions = await TermsAndConditions.findById(req.params.id);
        if (!termsAndConditions) {
            return res.status(404).json({ success: false, message: "Terms and Conditions not found" });
        }
        res.json({ success: true, data: termsAndConditions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateTermsAndConditions = async (req, res) => {
    try {
        const { title, paragraphs } = req.body;
        const oldTermsAndConditions = await TermsAndConditions.findById(req.params.id);

        if (!oldTermsAndConditions) {
            return res.status(404).json({ success: false, message: "Terms and Conditions not found" });
        }

        const termsAndConditions = await TermsAndConditions.findByIdAndUpdate(
            req.params.id,
            { title, paragraphs },
            { new: true, runValidators: true }
        );

        await logCRUDActivity(req, 'UPDATE', 'TermsAndConditions', termsAndConditions._id, { before: oldTermsAndConditions.toObject(), after: termsAndConditions.toObject() }, { title });

        res.json({ success: true, data: termsAndConditions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteTermsAndConditions = async (req, res) => {
    try {
        const termsAndConditions = await TermsAndConditions.findByIdAndDelete(req.params.id);
        if (!termsAndConditions) {
            return res.status(404).json({ success: false, message: "Terms and Conditions not found" });
        }

        await logCRUDActivity(req, 'DELETE', 'TermsAndConditions', termsAndConditions._id, null, { title: termsAndConditions.title });

        res.json({ success: true, message: "Terms and Conditions deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
