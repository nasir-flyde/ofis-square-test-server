import NotificationCategory from "../models/NotificationCategoryModel.js";
import mongoose from "mongoose";
import { logCRUDActivity } from "../utils/activityLogger.js";

// Create a new category
export const createCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || !description) {
            return res.status(400).json({ success: false, message: "Name and description are required" });
        }

        const existingCategory = await NotificationCategory.findOne({ name });
        if (existingCategory) {
            return res.status(400).json({ success: false, message: "A category with this name already exists" });
        }

        const category = new NotificationCategory({ name, description });
        await category.save();

        if (req.user) {
            await logCRUDActivity(req.user.id, 'CREATE', 'notificationCategory', category._id, { name });
        }

        res.status(201).json({ success: true, data: category, message: "Category created successfully" });
    } catch (error) {
        console.error("Create category error:", error);
        res.status(500).json({ success: false, message: "Failed to create category", error: error.message });
    }
};

// Get all categories
export const getAllCategories = async (req, res) => {
    try {
        const categories = await NotificationCategory.find().sort({ name: 1 });
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error("Get categories error:", error);
        res.status(500).json({ success: false, message: "Failed to retrieve categories", error: error.message });
    }
};

// Get category by ID
export const getCategoryById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid category ID" });
        }

        const category = await NotificationCategory.findById(id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.json({ success: true, data: category });
    } catch (error) {
        console.error("Get category error:", error);
        res.status(500).json({ success: false, message: "Failed to retrieve category", error: error.message });
    }
};

// Update category
export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid category ID" });
        }

        if (name) {
            const existingCategory = await NotificationCategory.findOne({ name, _id: { $ne: id } });
            if (existingCategory) {
                return res.status(400).json({ success: false, message: "A different category with this name already exists" });
            }
        }

        const category = await NotificationCategory.findByIdAndUpdate(
            id,
            { ...(name && { name }), ...(description && { description }) },
            { new: true, runValidators: true }
        );

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        if (req.user) {
            await logCRUDActivity(req.user.id, 'UPDATE', 'notificationCategory', category._id, { name, description });
        }

        res.json({ success: true, data: category, message: "Category updated successfully" });
    } catch (error) {
        console.error("Update category error:", error);
        res.status(500).json({ success: false, message: "Failed to update category", error: error.message });
    }
};

// Delete category
export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid category ID" });
        }

        const category = await NotificationCategory.findByIdAndDelete(id);

        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        if (req.user) {
            await logCRUDActivity(req.user.id, 'DELETE', 'notificationCategory', category._id, { name: category.name });
        }

        res.json({ success: true, message: "Category deleted successfully" });
    } catch (error) {
        console.error("Delete category error:", error);
        res.status(500).json({ success: false, message: "Failed to delete category", error: error.message });
    }
};
