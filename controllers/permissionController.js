import Permission from "../models/permissionModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// Get all permissions
export const getPermissions = async (req, res) => {
  try {
    const { category, resource } = req.query;
    
    const filter = {};
    if (category) filter.category = category;
    if (resource) filter.resource = resource;
    
    const permissions = await Permission.find(filter)
      .sort({ category: 1, resource: 1, action: 1 });
    
    return res.json({ success: true, data: permissions });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    await logErrorActivity(req, error, 'Get Permissions');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message
    });
  }
};

// Get permission by ID
export const getPermissionById = async (req, res) => {
  try {
    const { id } = req.params;
    const permission = await Permission.findById(id);
    
    if (!permission) {
      return res.status(404).json({ success: false, message: "Permission not found" });
    }
    
    return res.json({ success: true, data: permission });
  } catch (err) {
    console.error("getPermissionById error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permission',
      error: err.message
    });
  }
};

// Create a new permission
export const createPermission = async (req, res) => {
  try {
    const { name, resource, action, scope, description, category } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!resource) {
      return res.status(400).json({ error: "resource is required" });
    }
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }

    // Check for existing permission with same name
    const existing = await Permission.findOne({ name });
    if (existing) {
      return res.status(409).json({ error: "Permission with same name already exists" });
    }

    const permission = await Permission.create({
      name,
      resource,
      action,
      scope: scope || "all",
      description,
      category
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Permission', permission._id, null, {
      name,
      resource,
      action
    });

    res.status(201).json({
      success: true,
      message: 'Permission created successfully',
      data: permission
    });
  } catch (err) {
    console.error("createPermission error:", err);
    await logErrorActivity(req, err, 'Permission Creation');
    res.status(500).json({
      success: false,
      message: 'Failed to create permission',
      error: err.message
    });
  }
};

// Update a permission
export const updatePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, resource, action, scope, description, category, isActive } = req.body || {};

    const oldPermission = await Permission.findById(id);
    if (!oldPermission) {
      return res.status(404).json({ success: false, message: 'Permission not found' });
    }

    // Check for duplicate name
    if (name && name !== oldPermission.name) {
      const conflict = await Permission.findOne({ _id: { $ne: id }, name });
      if (conflict) {
        return res.status(409).json({ error: "Another permission with same name exists" });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (resource) updateData.resource = resource;
    if (action) updateData.action = action;
    if (scope) updateData.scope = scope;
    if (description !== undefined) updateData.description = description;
    if (category) updateData.category = category;
    if (isActive !== undefined) updateData.isActive = isActive;

    const permission = await Permission.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Permission', id, {
      before: oldPermission.toObject(),
      after: permission.toObject(),
      fields: Object.keys(updateData)
    }, {
      name: permission.name,
      updatedFields: Object.keys(updateData)
    });

    res.json({
      success: true,
      message: 'Permission updated successfully',
      data: permission
    });
  } catch (error) {
    console.error('Error updating permission:', error);
    await logErrorActivity(req, error, 'Permission Update');
    res.status(500).json({
      success: false,
      message: 'Failed to update permission',
      error: error.message
    });
  }
};

// Delete a permission
export const deletePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const permission = await Permission.findByIdAndDelete(id);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Permission', id, null, {
      name: permission.name,
      resource: permission.resource,
      action: permission.action
    });

    res.json({
      success: true,
      message: 'Permission deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting permission:', error);
    await logErrorActivity(req, error, 'Permission Deletion');
    res.status(500).json({
      success: false,
      message: 'Failed to delete permission',
      error: error.message
    });
  }
};

// Get permissions grouped by category
export const getPermissionsByCategory = async (req, res) => {
  try {
    const permissions = await Permission.find({ isActive: true })
      .sort({ category: 1, resource: 1, action: 1 });
    
    // Group by category
    const grouped = permissions.reduce((acc, perm) => {
      const cat = perm.category || 'other';
      if (!acc[cat]) {
        acc[cat] = [];
      }
      acc[cat].push(perm);
      return acc;
    }, {});
    
    return res.json({ success: true, data: grouped });
  } catch (error) {
    console.error('Error fetching permissions by category:', error);
    await logErrorActivity(req, error, 'Get Permissions by Category');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message
    });
  }
};
