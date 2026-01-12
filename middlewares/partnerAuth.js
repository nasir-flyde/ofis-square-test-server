import jwt from "jsonwebtoken";

export default function partnerAuth(requiredPartner = null) {
  return function (req, res, next) {
    try {
      const header = req.headers.authorization || req.headers.Authorization;
      if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Missing Authorization header" });
      }
      const token = header.split(" ")[1];
      const secret = process.env.PARTNER_JWT_SECRET || process.env.JWT_SECRET || "ofis-square-secret-key";
      const decoded = jwt.verify(token, secret);
      if (requiredPartner && decoded.partner !== requiredPartner) {
        return res.status(403).json({ success: false, message: "Invalid partner token" });
      }
      req.partner = decoded.partner || null;
      req.partnerScopes = decoded.scopes || [];
      req.partnerId = decoded.partnerId || null;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: err.message || "Invalid token" });
    }
  }
}
