import jwt from "jsonwebtoken";
import Member from "../models/memberModel.js";
import Client from "../models/clientModel.js";
import Guest from "../models/guestModel.js";
import dotenv from "dotenv";
dotenv.config();

// Middleware to extract host information from JWT token
const hostMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
    } catch (e) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    // Initialize host info
    req.hostInfo = {
      type: null,
      id: null,
      data: null
    };

    // Determine host type and ID based on JWT payload
    if (decoded.memberId) {
      // User is a member
      const member = await Member.findById(decoded.memberId);
      if (member) {
        req.hostInfo = {
          type: 'member',
          id: decoded.memberId,
          data: member
        };
      }
    } else if (decoded.clientId) {
      // User is a client
      const client = await Client.findById(decoded.clientId);
      if (client) {
        req.hostInfo = {
          type: 'client',
          id: decoded.clientId,
          data: client
        };
      }
    } else if (decoded.guestId) {
      // User is a guest (OnDemandUser)
      const guest = await Guest.findById(decoded.guestId);
      if (guest) {
        req.hostInfo = {
          type: 'guest',
          id: decoded.guestId,
          data: guest
        };
      }
    }

    // If no host info found, check if user has a role that maps to a host type
    if (!req.hostInfo.type && decoded.roleName) {
      const roleName = decoded.roleName.toLowerCase();
      
      if (roleName === 'member' && decoded.id) {
        // Try to find member by user ID
        const member = await Member.findOne({ user: decoded.id });
        if (member) {
          req.hostInfo = {
            type: 'member',
            id: member._id,
            data: member
          };
        }
      } else if (roleName === 'client' && decoded.id) {
        // Try to find client by owner user ID
        const client = await Client.findOne({ ownerUser: decoded.id });
        if (client) {
          req.hostInfo = {
            type: 'client',
            id: client._id,
            data: client
          };
        }
      }
    }

    next();
  } catch (error) {
    console.error("Host middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default hostMiddleware;
