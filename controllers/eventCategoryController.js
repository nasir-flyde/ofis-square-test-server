import EventCategory from '../models/eventCategoryModel.js';
import Event from '../models/eventModel.js';
import { logCRUDActivity } from '../utils/activityLogger.js';

// Create Event Category
const createEventCategory = async (req, res) => {
  try {
    const { name, description, color, icon, subcategories } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    // Check if category already exists
    const existingCategory = await EventCategory.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    const category = new EventCategory({
      name,
      description,
      subcategories,
      color: color || '#3B82F6',
      icon,
      createdBy: req.user.id
    });

    await category.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'CREATE', 'EventCategory', category._id, null, category.toObject());

    res.status(201).json({
      success: true,
      message: 'Event category created successfully',
      data: category
    });

  } catch (error) {
    console.error('Create event category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create event category',
      error: error.message
    });
  }
};

// Get All Event Categories
const getEventCategories = async (req, res) => {
  try {
    const { active } = req.query;

    const query = {};
    if (active !== undefined) {
      query.isActive = active === 'true';
    }

    const categories = await EventCategory.find(query)
      .populate('createdBy', 'name email')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Get event categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event categories',
      error: error.message
    });
  }
};

// Get Single Event Category
const getEventCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await EventCategory.findById(id)
      .populate('createdBy', 'name email');

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Event category not found'
      });
    }

    res.json({
      success: true,
      data: category
    });

  } catch (error) {
    console.error('Get event category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event category',
      error: error.message
    });
  }
};

// Update Event Category
const updateEventCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const category = await EventCategory.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Event category not found'
      });
    }

    // Check if name is being updated and already exists
    if (updates.name && updates.name !== category.name) {
      const existingCategory = await EventCategory.findOne({ name: updates.name });
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists'
        });
      }
    }

    const oldData = category.toObject();

    // Update allowed fields
    const allowedUpdates = ['name', 'description', 'color', 'icon', 'isActive', 'subcategories'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        category[field] = updates[field];
      }
    });

    await category.save();

    // Log activity
    await logCRUDActivity(req.user.id, 'UPDATE', 'EventCategory', category._id, oldData, category.toObject());

    res.json({
      success: true,
      message: 'Event category updated successfully',
      data: category
    });

  } catch (error) {
    console.error('Update event category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event category',
      error: error.message
    });
  }
};

// Delete Event Category
const deleteEventCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await EventCategory.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Event category not found'
      });
    }

    // Check if category is being used by any events
    const eventsUsingCategory = await Event.countDocuments({ category: id });

    if (eventsUsingCategory > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. It is being used by ${eventsUsingCategory} event(s)`
      });
    }

    await EventCategory.findByIdAndDelete(id);

    // Log activity
    await logCRUDActivity(req.user.id, 'DELETE', 'EventCategory', category._id, category.toObject(), null);

    res.json({
      success: true,
      message: 'Event category deleted successfully'
    });

  } catch (error) {
    console.error('Delete event category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event category',
      error: error.message
    });
  }
};

export default {
  createEventCategory,
  getEventCategories,
  getEventCategory,
  updateEventCategory,
  deleteEventCategory
};
