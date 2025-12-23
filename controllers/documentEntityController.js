import DocumentEntity from "../models/documentEntityModel.js";

// GET /api/document-entities
// Optional query params:
// - entity or entityType: filter by entityType value
// - includeInactive: when 'true', include inactive; otherwise defaults to active-only
// - q: optional case-insensitive text search on name or fieldName
export const listDocumentEntities = async (req, res) => {
  try {
    const { entity, entityType, includeInactive, q } = req.query || {};

    const filter = {};
    const type = entity || entityType;
    if (type) filter.entityType = type;
    if (!includeInactive || String(includeInactive).toLowerCase() === 'false') {
      filter.isActive = true;
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { fieldName: { $regex: term, $options: 'i' } },
      ];
    }

    const docs = await DocumentEntity.find(filter)
      .select('_id name fieldName entityType required description isActive createdAt updatedAt')
      .sort({ name: 1 })
      .lean();

    return res.json({ success: true, data: docs });
  } catch (err) {
    console.error('listDocumentEntities error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load document entities' });
  }
};

// POST /api/document-entities
export const createDocumentEntity = async (req, res) => {
  try {
    const { name, fieldName, entityType, required = false, description = '', isActive = true } = req.body || {};
    if (!name || !fieldName) {
      return res.status(400).json({ success: false, message: 'name and fieldName are required' });
    }
    const payload = {
      name: String(name).trim(),
      fieldName: String(fieldName).trim(),
      entityType: entityType ? String(entityType).trim() : undefined,
      required: Boolean(required),
      description: description ? String(description).trim() : undefined,
      isActive: Boolean(isActive),
    };
    const created = await DocumentEntity.create(payload);
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ success: false, message: 'fieldName must be unique' });
    }
    console.error('createDocumentEntity error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create document entity' });
  }
};

// PUT /api/document-entities/:id
export const updateDocumentEntity = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, fieldName, entityType, required, description, isActive } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (fieldName !== undefined) updates.fieldName = String(fieldName).trim();
    if (entityType !== undefined) updates.entityType = entityType ? String(entityType).trim() : undefined;
    if (required !== undefined) updates.required = Boolean(required);
    if (description !== undefined) updates.description = description ? String(description).trim() : undefined;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const updated = await DocumentEntity.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ success: false, message: 'DocumentEntity not found' });

    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ success: false, message: 'fieldName must be unique' });
    }
    console.error('updateDocumentEntity error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update document entity' });
  }
};

// DELETE /api/document-entities/:id
export const deleteDocumentEntity = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await DocumentEntity.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'DocumentEntity not found' });
    return res.json({ success: true, message: 'DocumentEntity deleted' });
  } catch (err) {
    console.error('deleteDocumentEntity error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete document entity' });
  }
};
