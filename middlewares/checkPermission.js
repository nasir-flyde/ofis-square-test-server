const checkPermission = (required) => {
  if (!required) throw new Error("checkPermission requires a permission string");
  return (req, res, next) => {
    try {
      const role = req.userRole; // set by authVerify.js
      if (!role) return res.status(401).json({ error: "Unauthorized" });

      // Admin bypass
      if (role.roleName && role.roleName.toLowerCase() === "admin") {
        return next();
      }

      const perms = Array.isArray(role.permissions) ? role.permissions : [];
      if (!perms.includes(required) && !perms.includes("*")) {
        return res.status(403).json({ error: "Forbidden: missing permission", required });
      }

      return next();
    } catch (err) {
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
};

export default checkPermission;
