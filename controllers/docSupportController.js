import DocSupportUser from "../models/docSupportUserModel.js";
import DocSupportTicket from "../models/docSupportTicketModel.js";
import DocSupportCategory from "../models/docSupportCategoryModel.js";
import jwt from "jsonwebtoken";
import imagekit from "../utils/imageKit.js";
import path from "path";

// Generate JWT Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: "30d",
    });
};

// @desc    Register a new doc support user
// @route   POST /api/doc-support/signup
export const signup = async (req, res) => {
    const { username, password, fullName, phone } = req.body;

    try {
        const userExists = await DocSupportUser.findOne({ username });

        if (userExists) {
            return res.status(400).json({ success: false, message: "User already exists" });
        }

        const user = await DocSupportUser.create({
            username,
            password,
            fullName,
            phone,
        });

        if (user) {
            res.status(201).json({
                success: true,
                _id: user._id,
                username: user.username,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ success: false, message: "Invalid user data" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Authenticate doc support user & get token
// @route   POST /api/doc-support/login
export const login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await DocSupportUser.findOne({ username });

        if (user && (await user.comparePassword(password))) {
            res.json({
                success: true,
                _id: user._id,
                username: user.username,
                token: generateToken(user._id),
            });
        } else {
            res.status(401).json({ success: false, message: "Invalid username or password" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create a support ticket
// @route   POST /api/doc-support/tickets
export const createTicket = async (req, res) => {
    const { title, subject, category, description } = req.body;

    try {
        let imageUrl = "";

        if (req.file) {
            const uploadResponse = await imagekit.upload({
                file: req.file.buffer, // upload from memory
                fileName: `doc-support-ticket-${Date.now()}${path.extname(req.file.originalname)}`,
                folder: "/doc-support-tickets",
            });
            imageUrl = uploadResponse.url;
        }

        const ticket = await DocSupportTicket.create({
            title,
            subject,
            category,
            description,
            image: imageUrl,
            createdBy: req.user._id,
        });

        res.status(201).json({
            success: true,
            data: ticket,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getCategories = async (req, res) => {
    try {
        const categories = await DocSupportCategory.find().sort({ name: 1 });
        const cleanedCategories = categories.map(cat => ({
            _id: cat._id,
            name: typeof cat.name === 'object' && cat.name?.type ? cat.name.type : String(cat.name || 'Unknown')
        }));
        res.json({ success: true, data: cleanedCategories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
