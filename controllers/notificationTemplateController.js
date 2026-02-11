import NotificationTemplate from "../models/notificationTemplateModel.js";
import TemplateDesign from "../models/templateDesignModel.js";
import { renderDBTemplateContent, renderTemplateByKey } from "../services/notifications/templateService.js";

// List templates with filters and pagination
export const listTemplates = async (req, res) => {
  try {
    const { page = 1, limit = 20, q, category, tag, isActive } = req.query;
    const query = {};
    if (typeof isActive !== 'undefined') query.isActive = String(isActive) === 'true';
    if (category) query.category = category;
    if (tag) query.tags = tag;
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { key: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      NotificationTemplate.find(query)
        .populate("templateDesignId")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      NotificationTemplate.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalRecords: total,
        hasMore: skip + items.length < total,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list templates', error: error.message });
  }
};

// Get template by id
export const getTemplateById = async (req, res) => {
  try {
    const item = await NotificationTemplate.findById(req.params.id).populate("templateDesignId");
    if (!item) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch template', error: error.message });
  }
};

// Get template by key
export const getTemplateByKeyRoute = async (req, res) => {
  try {
    const item = await NotificationTemplate.findOne({ key: req.params.key }).populate("templateDesignId");
    if (!item) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch template', error: error.message });
  }
};

// Create template
export const createTemplate = async (req, res) => {
  try {
    const { key, name, description, channels, content, category, tags, isActive, defaults, version, templateDesignId } = req.body;

    if (!key || !name) {
      return res.status(400).json({ success: false, message: 'Key and name are required' });
    }

    const existing = await NotificationTemplate.findOne({ key });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A template with this key already exists' });
    }

    const item = await NotificationTemplate.create({
      key,
      name,
      description,
      channels,
      content,
      category,
      tags,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      defaults,
      version: version || 1,
      templateDesignId,
      createdBy: req.user?._id,
      updatedBy: req.user?._id,
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create template', error: error.message });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedBy: req.user?._id };
    const item = await NotificationTemplate.findByIdAndUpdate(id, updates, { new: true }).populate("templateDesignId");
    if (!item) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update template', error: error.message });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await NotificationTemplate.findByIdAndUpdate(id, { isActive: false, updatedBy: req.user?._id }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: item, message: 'Template deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete template', error: error.message });
  }
};

export const previewTemplate = async (req, res) => {
  try {
    const { key, content, variables = {}, templateDesignId } = req.body || {};
    if (!key && !content) {
      return res.status(400).json({ success: false, message: 'Provide either key or content to render' });
    }

    if (key) {
      const rendered = await renderTemplateByKey(key, variables);
      return res.json({ success: true, data: rendered });
    }
    const templateDoc = { content };
    if (templateDesignId) {
      console.log('Fetching design for preview:', templateDesignId);
      const design = await TemplateDesign.findById(templateDesignId);
      if (design) {
        templateDoc.templateDesignId = design;
      }
    }
    const rendered = renderDBTemplateContent(templateDoc, variables);
    return res.json({ success: true, data: rendered });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to render preview', error: error.message });
  }
};
