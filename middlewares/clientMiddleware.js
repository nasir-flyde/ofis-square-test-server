import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

// Allows access only to users with roleName 'admin' or 'client'.
// Works with or without authVerify: if req.userRole is absent, it will read JWT and extract roleName.
const clientMiddleware = (req, res, next) => {
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
        if (decoded?.clientId) req.clientId = decoded.clientId;
        // Attach a minimal req.user so other middlewares (activity logger) can read userId
        if (!req.user && decoded?.id) {
          req.user = {
            _id: decoded.id,
            name: decoded.name || undefined,
            email: decoded.email || undefined,
            roleName: roleName || undefined,
          };
        }
      } catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    if (!roleName) return res.status(401).json({ error: "Unauthorized" });

    const name = String(roleName).toLowerCase();
    if (name === "admin" || name === "client") {
      return next();
    }
    if (name === "client legal team") {
      const path = req.path || "";
      if (typeof path === 'string' && path.startsWith('/contracts')) {
        return next();
      }
      return res.status(403).json({ error: "Forbidden: Client Legal Team can access contracts only" });
    }

    return res.status(403).json({ error: "Forbidden: role not allowed for client routes" });
  } catch (err) {
    return res.status(500).json({ error: "Client middleware failed" });
  }
};

export default clientMiddleware;
