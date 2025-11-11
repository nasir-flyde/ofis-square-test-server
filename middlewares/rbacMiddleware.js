import { hasPermission, hasAnyPermission, hasAllPermissions } from "../constants/permissions.js";
import { attachPermissionChecker } from "../utils/rbacHelper.js";
import User from "../models/userModel.js";

export const populateUserRole = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = await User.findById(req.user._id).populate("role").lean();
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.role) {
      user.role = {
        roleName: "No Role",
        permissions: [],
        canLogin: true
      };
    }

    req.user = user;
    attachPermissionChecker(req);

    next();
  } catch (error) {
    console.error("Error populating user role:", error);
    return res.status(500).json({ message: "Error loading user permissions" });
  }
};

export const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
        return res.status(403).json({ 
          message: "Access denied. No role assigned.",
          required: permission 
        });
      }

      if (req.user.role.roleName === 'client' || req.user.role.roleName === 'community') {
        return next();
      }
      if (!req.user.role.permissions) {
        return res.status(403).json({ 
          message: "Access denied. No permissions assigned to role.",
          required: permission,
          userRole: req.user.role.roleName
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

export const requireSystemAdmin = requirePermission("*:*");
