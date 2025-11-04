import Role from "../models/roleModel.js";
import User from "../models/userModel.js";
import { PERMISSIONS, hasPermission, hasAnyPermission, hasAllPermissions } from "../constants/permissions.js";

/**
 * Get user with populated role and permissions
 * @param {String} userId - User ID
 * @returns {Object} User with role and permissions
 */
export const getUserWithPermissions = async (userId) => {
  const user = await User.findById(userId).populate("role").lean();
  if (!user) {
    throw new Error("User not found");
  }
  return user;
};

/**
 * Check if user has a specific permission
 * @param {String} userId - User ID
 * @param {String} permission - Permission to check
 * @returns {Boolean}
 */
export const userHasPermission = async (userId, permission) => {
  const user = await getUserWithPermissions(userId);
  if (!user.role || !user.role.permissions) {
    return false;
  }
  return hasPermission(user.role.permissions, permission);
};

/**
 * Check if user has any of the specified permissions
 * @param {String} userId - User ID
 * @param {Array} permissions - Array of permissions
 * @returns {Boolean}
 */
export const userHasAnyPermission = async (userId, permissions) => {
  const user = await getUserWithPermissions(userId);
  if (!user.role || !user.role.permissions) {
    return false;
  }
  return hasAnyPermission(user.role.permissions, permissions);
};

/**
 * Check if user has all specified permissions
 * @param {String} userId - User ID
 * @param {Array} permissions - Array of permissions
 * @returns {Boolean}
 */
export const userHasAllPermissions = async (userId, permissions) => {
  const user = await getUserWithPermissions(userId);
  if (!user.role || !user.role.permissions) {
    return false;
  }
  return hasAllPermissions(user.role.permissions, permissions);
};

/**
 * Check if user is system admin
 * @param {String} userId - User ID
 * @returns {Boolean}
 */
export const isSystemAdmin = async (userId) => {
  return await userHasPermission(userId, PERMISSIONS.SYSTEM_ADMIN);
};

/**
 * Check if user can approve contracts (has contract:approve permission)
 * @param {String} userId - User ID
 * @returns {Boolean}
 */
export const canApproveContracts = async (userId) => {
  return await userHasPermission(userId, PERMISSIONS.CONTRACT_APPROVE);
};

/**
 * Get all permissions for a user
 * @param {String} userId - User ID
 * @returns {Array} Array of permission strings
 */
export const getUserPermissions = async (userId) => {
  const user = await getUserWithPermissions(userId);
  if (!user.role || !user.role.permissions) {
    return [];
  }
  return user.role.permissions;
};

/**
 * Check if a role has a specific permission
 * @param {String} roleId - Role ID
 * @param {String} permission - Permission to check
 * @returns {Boolean}
 */
export const roleHasPermission = async (roleId, permission) => {
  const role = await Role.findById(roleId).lean();
  if (!role || !role.permissions) {
    return false;
  }
  return hasPermission(role.permissions, permission);
};

/**
 * Add permission check to request object
 * Adds hasPermission method to req object
 * @param {Object} req - Express request object
 */
export const attachPermissionChecker = (req) => {
  req.hasPermission = (permission) => {
    if (!req.user || !req.user.role || !req.user.role.permissions) {
      return false;
    }
    return hasPermission(req.user.role.permissions, permission);
  };

  req.hasAnyPermission = (permissions) => {
    if (!req.user || !req.user.role || !req.user.role.permissions) {
      return false;
    }
    return hasAnyPermission(req.user.role.permissions, permissions);
  };

  req.hasAllPermissions = (permissions) => {
    if (!req.user || !req.user.role || !req.user.role.permissions) {
      return false;
    }
    return hasAllPermissions(req.user.role.permissions, permissions);
  };

  req.isSystemAdmin = () => {
    if (!req.user || !req.user.role || !req.user.role.permissions) {
      return false;
    }
    return hasPermission(req.user.role.permissions, PERMISSIONS.SYSTEM_ADMIN);
  };
};
