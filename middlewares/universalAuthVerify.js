import jwt from "jsonwebtoken";
import Users from "../models/userModel.js";
import Role from "../models/roleModel.js";
import Client from "../models/clientModel.js";
import Member from "../models/memberModel.js";
import Guest from "../models/guestModel.js";
import Building from "../models/buildingModel.js";
import dotenv from "dotenv";
dotenv.config();

const universalAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    
    // Check if it's a user token (admin/staff/member/community/ondemanduser)
    const user = await Users.findById(decoded.id);
    if (user) {
      const role = await Role.findById(user.role);
      if (!role) return res.status(401).json({ message: "User role not found" });

      if (role.canLogin === false) {
        return res.status(403).json({ message: "Role is not allowed to login" });
      }

      // Attach user and role info to request
      req.user = user;
      req.user.roleName = role.roleName;
      req.userRole = role;
      const roleName = String(role.roleName || '').toLowerCase();

      // Client user: attach client and member context
      if (roleName === 'client') {
        if (decoded.clientId) {
          const client = await Client.findById(decoded.clientId);
          if (client) {
            req.client = client;
            req.clientId = client._id;
          }
        }
        // Client can also have memberId in JWT
        if (decoded.memberId) {
          const member = await Member.findById(decoded.memberId);
          if (member) {
            req.member = member;
            req.memberId = member._id;
          }
        }
        req.authType = 'client';
        return next();
      }

      // Member user: attach member context
      if (roleName === 'member') {
        let member = null;
        if (decoded.memberId) {
          member = await Member.findById(decoded.memberId);
        }
        if (!member) {
          member = await Member.findOne({ user: user._id });
        }
        if (member) {
          req.member = member;
          req.memberId = member._id;
          if (member.client) req.clientId = member.client;
          req.authType = 'member';
          return next();
        }
        // Fallback to generic user if no member found
        req.authType = 'user';
        return next();
      }

      // Community user: attach building context
      if (roleName === 'community') {
        if (decoded.buildingId) {
          try {
            const building = await Building.findById(decoded.buildingId);
            if (building) req.building = building;
            req.buildingId = decoded.buildingId;
          } catch (e) {}
        }
        req.authType = 'community';
        return next();
      }

      // On-demand user: attach guest context
      if (roleName === 'ondemanduser') {
        // Note: ondemand uses guestId passed via createJWT's clientId param
        const guestId = decoded.clientId;
        if (guestId) {
          const guest = await Guest.findById(guestId);
          if (guest) {
            req.guest = guest;
            req.guestId = guest._id;
          }
        }
        req.authType = 'ondemand';
        return next();
      }
      req.authType = 'user';
      return next();
    }

    // Check if it's a client token (pure client portal token)
    const client = await Client.findById(decoded.clientId || decoded.id);
    if (client) {
      // Attach client info to request
      req.memberId = client.memberId;
      req.client = client;
      req.clientId = client._id;
      req.authType = 'client';
      return next();
    }

    return res.status(401).json({ message: "Invalid token: user/client not found" });

  } catch (err) {
    return res.status(401).json({ message: err.message, success: "false" });
  }
};

export default universalAuthMiddleware;
