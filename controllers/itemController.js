import Item from "../models/itemModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

/**
 * Get all items (active by default)
 */
export const getItems = async (req, res) => {
  try {
    const { activeOnly = true, search = "" } = req.query;
    let query = {};
    if (activeOnly === "true" || activeOnly === true) query.isActive = true;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }

    const items = await Item.find(query).sort({ name: 1 });
    res.json({ success: true, data: items });
  } catch (error) {
    await logErrorActivity(req, error, "Get Items");
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a new item
 */
export const createItem = async (req, res) => {
  try {
    const item = await Item.create(req.body);
    await logCRUDActivity(req, "CREATE", "Item", item._id, null, req.body);
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    await logErrorActivity(req, error, "Create Item");
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update an item
 */
export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findByIdAndUpdate(id, req.body, { new: true });
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    
    await logCRUDActivity(req, "UPDATE", "Item", item._id, null, req.body);
    res.json({ success: true, data: item });
  } catch (error) {
    await logErrorActivity(req, error, "Update Item");
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete an item (or deactivate)
 */
export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });

    await logCRUDActivity(req, "DELETE", "Item", item._id, null, { deleted: true });
    res.json({ success: true, message: "Item deleted successfully" });
  } catch (error) {
    await logErrorActivity(req, error, "Delete Item");
    res.status(500).json({ success: false, message: error.message });
  }
};
