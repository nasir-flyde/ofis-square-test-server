import PrivacyPolicy from "../models/privacyPolicyModel.js";
import { logCRUDActivity } from "../utils/activityLogger.js";

export const createPrivacyPolicy = async (req, res) => {
    try {
        const { title, paragraphs } = req.body;

        if (!title || !Array.isArray(paragraphs) || paragraphs.length === 0) {
            return res.status(400).json({ success: false, message: "Title and paragraphs array are required" });
        }

        const privacyPolicy = await PrivacyPolicy.create({ title, paragraphs });

        await logCRUDActivity(req, 'CREATE', 'PrivacyPolicy', privacyPolicy._id, null, { title });

        res.status(201).json({ success: true, data: privacyPolicy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPrivacyPolicies = async (req, res) => {
    try {
        const privacyPolicies = await PrivacyPolicy.find().sort({ createdAt: -1 });
        res.json({ success: true, data: privacyPolicies });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getPrivacyPolicyById = async (req, res) => {
    try {
        const privacyPolicy = await PrivacyPolicy.findById(req.params.id);
        if (!privacyPolicy) {
            return res.status(404).json({ success: false, message: "Privacy Policy not found" });
        }
        res.json({ success: true, data: privacyPolicy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updatePrivacyPolicy = async (req, res) => {
    try {
        const { title, paragraphs } = req.body;
        const oldPrivacyPolicy = await PrivacyPolicy.findById(req.params.id);

        if (!oldPrivacyPolicy) {
            return res.status(404).json({ success: false, message: "Privacy Policy not found" });
        }

        const privacyPolicy = await PrivacyPolicy.findByIdAndUpdate(
            req.params.id,
            { title, paragraphs },
            { new: true, runValidators: true }
        );

        await logCRUDActivity(req, 'UPDATE', 'PrivacyPolicy', privacyPolicy._id, { before: oldPrivacyPolicy.toObject(), after: privacyPolicy.toObject() }, { title });

        res.json({ success: true, data: privacyPolicy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deletePrivacyPolicy = async (req, res) => {
    try {
        const privacyPolicy = await PrivacyPolicy.findByIdAndDelete(req.params.id);
        if (!privacyPolicy) {
            return res.status(404).json({ success: false, message: "Privacy Policy not found" });
        }

        await logCRUDActivity(req, 'DELETE', 'PrivacyPolicy', privacyPolicy._id, null, { title: privacyPolicy.title });

        res.json({ success: true, message: "Privacy Policy deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
