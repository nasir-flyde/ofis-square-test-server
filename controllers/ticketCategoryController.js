import TicketCategory from "../models/ticketCategoryModel.js";

// Create a new ticket category
export const createTicketCategory = async (req, res) => {
  try {
    const { name, description, subCategories } = req.body || {};
    if (!name) return res.status(400).json({ message: "name is required" });
    const newCategory = await TicketCategory.create({ name, description, subCategories });
    res.status(201).json(newCategory);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all ticket categories
export const getAllTicketCategories = async (_req, res) => {
  try {
    const categories = await TicketCategory.find().sort({ createdAt: -1 });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a single ticket category by ID
export const getTicketCategoryById = async (req, res) => {
  try {
    const category = await TicketCategory.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.status(200).json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update a ticket category
export const updateTicketCategory = async (req, res) => {
  try {
    const updatedCategory = await TicketCategory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedCategory) return res.status(404).json({ message: "Category not found" });
    res.status(200).json(updatedCategory);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a ticket category
export const deleteTicketCategory = async (req, res) => {
  try {
    const deletedCategory = await TicketCategory.findByIdAndDelete(req.params.id);
    if (!deletedCategory) return res.status(404).json({ message: "Category not found" });
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
