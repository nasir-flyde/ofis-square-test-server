import { hasPermission, hasAnyPermission, hasAllPermissions } from "../constants/permissions.js";
import { attachPermissionChecker } from "../utils/rbacHelper.js";
import User from "../models/userModel.js";

/**
 * Middleware to populate user with role and permissions
 * Should be used after authVerify middleware
 */
export const populateUserRole = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Populate role with permissions
    const user = await User.findById(req.user._id).populate("role").lean();
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // If user has no role, create empty role object to prevent errors
    if (!user.role) {
      user.role = {
        roleName: "No Role",
        permissions: [],
        canLogin: true
      };
    }

    // Attach user with populated role to request
    req.user = user;

    // Attach permission checker methods to request
    attachPermissionChecker(req);

    next();
  } catch (error) {
    console.error("Error populating user role:", error);
    return res.status(500).json({ message: "Error loading user permissions" });
  }
};

/**
 * Middleware to check if user has a specific permission
 * @param {String} permission - Required permission
 */
export const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.role || !req.user.role.permissions) {
        return res.status(403).json({ 
          message: "Access denied. No role assigned.",
          required: permission 
        });
      }

      const userPermissions = req.user.role.permissions;
      
      if (!hasPermission(userPermissions, permission)) {
        return res.status(403).json({ 
          message: "Access denied. Insufficient permissions.",
          required: permission,
          userRole: req.user.role.roleName
        });
      }

      next();
    } catch (error) {
      console.error("Error checking permission:", error);
      return res.status(500).json({ message: "Error checking permissions" });
    }
  };
};

/**
 * Middleware to check if user has any of the specified permissions
 * @param {Array} permissions - Array of permissions (user needs at least one)
 */
export const requireAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.role || !req.user.role.permissions) {
        return res.status(403).json({ 
          message: "Access denied. No role assigned.",
          requiredAny: permissions 
        });
      }

      const userPermissions = req.user.role.permissions;
      
      if (!hasAnyPermission(userPermissions, permissions)) {
        return res.status(403).json({ 
          message: "Access denied. Insufficient permissions.",
          requiredAny: permissions,
          userRole: req.user.role.roleName
        });
      }

      next();
    } catch (error) {
      console.error("Error checking permissions:", error);
      return res.status(500).json({ message: "Error checking permissions" });
    }
  };
};

/**
 * Middleware to check if user has all specified permissions
 * @param {Array} permissions - Array of permissions (user needs all)
 */
export const requireAllPermissions = (permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.role || !req.user.role.permissions) {
        return res.status(403).json({ 
          message: "Access denied. No role assigned.",
          requiredAll: permissions 
        });
      }

      const userPermissions = req.user.role.permissions;
      
      if (!hasAllPermissions(userPermissions, permissions)) {
        return res.status(403).json({ 
          message: "Access denied. Insufficient permissions.",
          requiredAll: permissions,
          userRole: req.user.role.roleName
        });
      }

      next();
    } catch (error) {
      console.error("Error checking permissions:", error);
      return res.status(500).json({ message: "Error checking permissions" });
    }
  };
};

/**
 * Middleware to check if user is system admin
 */
export const requireSystemAdmin = requirePermission("*:*");
