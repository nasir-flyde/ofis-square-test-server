import Role from "../models/roleModel.js";

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
      ...(canLogin !== undefined && { canLogin }),
      ...(Array.isArray(permissions) && { permissions }),
    });
    return res.status(201).json({ message: "Role created", role });
  } catch (err) {
    // Fallback: if creation failed due to legacy roleId index, try to drop and retry once
    if (err?.code === 11000 && err?.keyPattern?.roleId) {
      try {
        await Role.collection.dropIndex("roleId_1");
        const { roleName, description, canLogin, permissions } = req.body || {};
        const role = await Role.create({
          roleName,
          description,
          ...(canLogin !== undefined && { canLogin }),
          ...(Array.isArray(permissions) && { permissions }),
        });
        return res.status(201).json({ message: "Role created", role, note: "Dropped legacy roleId index" });
      } catch (innerErr) {
        console.error("createRole retry error:", innerErr);
      }
    }
    console.error("createRole error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get all roles (simple list)
export const getRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
    return res.json(roles);
  } catch (err) {
    console.error("getRoles error:", err);
    return res.status(500).json({ error: "Failed to fetch roles" });
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
    return res.status(500).json({ error: "Failed to fetch role" });
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

    const updated = await Role.findByIdAndUpdate(
      id,
      { $set: { ...(roleName && { roleName }), ...(description !== undefined && { description }), ...(canLogin !== undefined && { canLogin }), ...(Array.isArray(permissions) && { permissions }) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: "Role not found" });
    return res.json({ message: "Role updated", role: updated });
  } catch (err) {
    console.error("updateRole error:", err);
    return res.status(500).json({ error: "Failed to update role" });
  }
};

// Delete a role by Mongo _id
export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Role.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Role not found" });
    return res.json({ message: "Role deleted" });
  } catch (err) {
    console.error("deleteRole error:", err);
    return res.status(500).json({ error: "Failed to delete role" });
  }
};
