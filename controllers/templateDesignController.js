import TemplateDesign from "../models/templateDesignModel.js";

// List designs with filters and pagination
export const listDesigns = async (req, res) => {
    try {
        const { page = 1, limit = 20, q, category, isActive } = req.query;
        const query = {};
        if (typeof isActive !== 'undefined') query.isActive = String(isActive) === 'true';
        if (category) query.category = category;
        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { key: { $regex: q, $options: 'i' } },
                { description: { $regex: q, $options: 'i' } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [items, total] = await Promise.all([
            TemplateDesign.find(query).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(limit)),
            TemplateDesign.countDocuments(query),
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
        res.status(500).json({ success: false, message: 'Failed to list designs', error: error.message });
    }
};

// Get design by id
export const getDesignById = async (req, res) => {
    try {
        const item = await TemplateDesign.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, message: 'Design not found' });
        res.json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch design', error: error.message });
    }
};

// Create design
export const createDesign = async (req, res) => {
    try {
        const { key, name, description, type, category, html, placeholders, isActive, isDefault, theme, version } = req.body;

        if (!key || !name || !html || !type) {
            return res.status(400).json({ success: false, message: 'Key, name, type, and html are required' });
        }

        const existing = await TemplateDesign.findOne({ key });
        if (existing) {
            return res.status(409).json({ success: false, message: 'A design with this key already exists' });
        }

        const item = await TemplateDesign.create({
            key,
            name,
            description,
            type,
            category,
            html,
            placeholders,
            isActive: typeof isActive === 'boolean' ? isActive : true,
            isDefault: typeof isDefault === 'boolean' ? isDefault : false,
            theme,
            version: version || 1,
            createdBy: req.user?._id,
            updatedBy: req.user?._id,
        });

        res.status(201).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create design', error: error.message });
    }
};

// Update design
export const updateDesign = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updatedBy: req.user?._id };
        const item = await TemplateDesign.findByIdAndUpdate(id, updates, { new: true });
        if (!item) return res.status(404).json({ success: false, message: 'Design not found' });
        res.json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update design', error: error.message });
    }
};

// Delete design (soft delete by deactivating)
export const deleteDesign = async (req, res) => {
    try {
        const { id } = req.params;
        const item = await TemplateDesign.findByIdAndUpdate(id, { isActive: false, updatedBy: req.user?._id }, { new: true });
        if (!item) return res.status(404).json({ success: false, message: 'Design not found' });
        res.json({ success: true, data: item, message: 'Design deactivated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete design', error: error.message });
    }
};
