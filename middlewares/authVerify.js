import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import dotenv from "dotenv";
dotenv.config(); // Make sure this is at the top before any env use

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    const user = await Users.findById(decoded.id);

    if (!user) return res.status(401).json({ message: "User not found" });

    // Get role and check login permission
    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ message: "User role not found" });

    if (role.canLogin === false) {
      return res.status(403).json({ message: "Role is not allowed to login" });
    }

    // Enforce admin-only access for routes using this middleware
    if ((role.roleName || "").toLowerCase() !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }

    // Attach user and role info to request
    req.user = user;
    req.user.roleName = role.roleName;
    req.userRole = role;

    next();
  } catch (err) {
    return res.status(401).json({ message: err.message, success: "false" });
  }
};

export default authMiddleware;
