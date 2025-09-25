import Role from "../models/roleModel.js";
import { logCRUDActivity, logErrorActivity } from "../utils/activityLogger.js";

// Temporary safeguard: remove legacy unique index on roleId if present
const removeLegacyRoleIdIndexIfAny = async () => {
  try {
    const indexes = await Role.collection.indexes();
    const hasLegacy = indexes.some((i) => i.name === "roleId_1");
    if (hasLegacy) {
      await Role.collection.dropIndex("roleId_1");
    }
  } catch (_err) {
    // ignore; index might not exist or lack permissions in some envs
  }
};

// Create a new role
export const createRole = async (req, res) => {
  try {
    const { roleName, description, canLogin, permissions } = req.body || {};

    if (!roleName) {
      return res.status(400).json({ error: "roleName is required" });
    }

    // Ensure any legacy unique index on roleId is removed to prevent E11000 dup key on { roleId: null }
    await removeLegacyRoleIdIndexIfAny();

    // Ensure uniqueness on roleName
    const existing = await Role.findOne({ roleName });
    if (existing) {
      return res.status(409).json({ error: "Role with same roleName already exists" });
    }

    const role = await Role.create({
      roleName,
      description,
      permissions,
      canLogin: canLogin !== undefined ? canLogin : true
    });

    // Log activity
    await logCRUDActivity(req, 'CREATE', 'Role', role._id, null, {
      roleName,
      permissions: permissions?.length || 0
    });

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role
    });
  } catch (err) {
    // Fallback: if creation failed due to legacy roleId index, try to drop and retry once
    if (err?.code === 11000 && err?.keyPattern?.roleId) {
      try {
        await Role.collection.dropIndex("roleId_1");
        const { roleName, description, canLogin, permissions } = req.body || {};
        const role = await Role.create({
          roleName,
          description,
          permissions,
          canLogin: canLogin !== undefined ? canLogin : true
        });

        // Log activity
        await logCRUDActivity(req, 'CREATE', 'Role', role._id, null, {
          roleName,
          permissions: permissions?.length || 0
        });

        res.status(201).json({
          success: true,
          message: 'Role created successfully',
          data: role
        });
      } catch (innerErr) {
        console.error("createRole retry error:", innerErr);
      }
    }
    console.error("createRole error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to create role',
      error: err.message
    });
  }
};

// Get all roles (simple list)
export const getRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
    return res.json(roles);
  } catch (error) {
    console.error('Error creating role:', error);
    await logErrorActivity(req, error, 'Role Creation');
    res.status(500).json({
      success: false,
      message: 'Failed to create role',
      error: error.message
    });
  }
};

// Get a single role by Mongo _id
export const getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    return res.json(role);
  } catch (err) {
    console.error("getRoleById error:", err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role',
      error: err.message
    });
  }
};

// Update a role by Mongo _id
export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { roleName, description, canLogin, permissions } = req.body || {};

    // Prevent duplicate roleName on update
    if (roleName) {
      const conflict = await Role.findOne({ _id: { $ne: id }, roleName });
      if (conflict) return res.status(409).json({ error: "Another role with same roleName exists" });
    }

    const oldRole = await Role.findById(id);
    const role = await Role.findByIdAndUpdate(
      id,
      { roleName, description, permissions, canLogin },
      { new: true, runValidators: true }
    );

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'UPDATE', 'Role', id, {
      before: oldRole?.toObject(),
      after: role.toObject(),
      fields: ['roleName', 'description', 'permissions', 'canLogin']
    }, {
      roleName: role.roleName,
      updatedFields: ['roleName', 'description', 'permissions', 'canLogin']
    });

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: role
    });
  } catch (error) {
    console.error('Error updating role:', error);
    await logErrorActivity(req, error, 'Role Update');
    res.status(500).json({
      success: false,
      message: 'Failed to update role',
      error: error.message
    });
  }
};

// Delete a role by Mongo _id
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findByIdAndDelete(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Log activity
    await logCRUDActivity(req, 'DELETE', 'Role', id, null, {
      roleName: role.roleName
    });

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    await logErrorActivity(req, error, 'Role Deletion');
    res.status(500).json({
      success: false,
      message: 'Failed to delete role',
      error: error.message
    });
  }
};
