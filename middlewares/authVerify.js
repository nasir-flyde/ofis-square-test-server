import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import dotenv from "dotenv";
dotenv.config();

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    const user = await Users.findById(decoded.id);

    if (!user) return res.status(401).json({ message: "User not found" });

    const role = await Role.findById(user.role);
    if (!role) return res.status(401).json({ message: "User role not found" });

    if (role.canLogin === false) {
      return res.status(403).json({ message: "Role is not allowed to login" });
    }

    req.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      buildingId: user.buildingId,
      role: user.role,
      roleName: role.roleName
    };
    
    req.userRole = role;
    
    // Attach clientId from JWT token if present
    if (decoded.clientId) {
      req.clientId = decoded.clientId;
    }

    next();
  } catch (err) {
    return res.status(401).json({ message: err.message, success: "false" });
  }
};

export default authMiddleware;
