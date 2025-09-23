import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// Allows access only to users with roleName 'community'.
// Works with or without authVerify: if req.userRole is absent, it will read JWT and extract roleName.
const communityMiddleware = (req, res, next) => {
  try {
    let roleName;

    if (req.userRole?.roleName) {
      roleName = req.userRole.roleName;
    } else {
      // Fallback: read JWT directly
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
      if (!token) return res.status(401).json({ error: "Unauthorized" });
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "ofis-square-secret-key");
        roleName = decoded?.roleName;
        // Attach minimal role info for downstream handlers
        if (roleName && !req.userRole) req.userRole = { roleName };
        if (decoded?.id) req.userId = decoded.id;
        if (decoded?.buildingId) req.buildingId = decoded.buildingId;
      } catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    if (!roleName) return res.status(401).json({ error: "Unauthorized" });

    const name = String(roleName).toLowerCase();
    if (name === "community") {
      return next();
    }

    return res.status(403).json({ error: "Forbidden: community access required" });
  } catch (err) {
    return res.status(500).json({ error: "Community middleware failed" });
  }
};

export default communityMiddleware;
