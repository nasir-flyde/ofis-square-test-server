import jwt from "jsonwebtoken";

export const createJWT = (id, email, roleId, roleName, phone, clientId, memberId, buildingId, allowedUsingCredits) => {
  return jwt.sign(
    {
      id,
      email,
      roleId,
      roleName,
      phone,
      ...(clientId ? { clientId } : {}),
      ...(memberId ? { memberId } : {}),
      ...(buildingId ? { buildingId } : {}),
      ...(typeof allowedUsingCredits === 'boolean' ? { allowedUsingCredits } : {}),
    },
    process.env.JWT_SECRET || "ofis-square-secret-key",
    {
      expiresIn: "100d",
    }
  );
};
