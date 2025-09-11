import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const memberMiddleware = (req, res, next) => {
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

    const roleName = decoded?.roleName;
    if (!roleName || String(roleName).toLowerCase() !== "member") {
      return res.status(403).json({ error: "Forbidden: Member access required" });
    }

    if (!decoded.memberId) {
      return res.status(403).json({ error: "Forbidden: Member ID not found in token" });
    }

    if (!decoded.clientId) {
      return res.status(403).json({ error: "Forbidden: Client ID not found in token" });
    }

    req.memberId = decoded.memberId;
    req.clientId = decoded.clientId;
    req.userId = decoded.id;
    req.userRole = { roleName: "member" };

    next();
  } catch (err) {
    console.error("Member middleware error:", err);
    return res.status(500).json({ error: "Member middleware failed" });
  }
};

export default memberMiddleware;
