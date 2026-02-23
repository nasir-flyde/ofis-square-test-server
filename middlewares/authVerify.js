import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Lead from "../models/leadModel.js";
import dotenv from "dotenv";
dotenv.config();

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    let user;
    let roleName = decoded.roleName;

    if (roleName === 'lead') {
      user = await Lead.findById(decoded.id);
      if (!user) return res.status(401).json({ message: "Lead not found" });

      req.user = {
        _id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        roleName: 'lead'
      };
    } else {
      user = await Users.findById(decoded.id);
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
        role: {
          _id: role._id,
          roleName: role.roleName,
          name: role.roleName
        },
        roleName: role.roleName
      };
      req.userRole = role;
    }

    // Attach extra fields from JWT token to req.user
    if (decoded.clientId) {
      req.clientId = decoded.clientId;
      req.user.clientId = decoded.clientId;
    }
    if (decoded.memberId) {
      req.user.memberId = decoded.memberId;
    }
    if (decoded.guestId) {
      req.user.guestId = decoded.guestId;
    }

    next();
  } catch (err) {
    return res.status(401).json({ message: err.message, success: "false" });
  }
};

export default authMiddleware;
