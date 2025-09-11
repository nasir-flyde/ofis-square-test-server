import jwt from "jsonwebtoken";

export const createJWT = (id, email, roleId, roleName, phone, clientId, memberId) => {
  return jwt.sign(
    {
      id,
      email,
      roleId,
      roleName,
      phone,
      ...(clientId ? { clientId } : {}),
      ...(memberId ? { memberId } : {}),
    },
    process.env.JWT_SECRET || "ofis-square-secret-key",
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    }
  );
};
