import jwt from "jsonwebtoken";
import crypto from "crypto";

/**
 * Create access token (short-lived)
 */
export const createAccessToken = (id, email, roleId, roleName, phone, clientId, memberId, buildingId, allowedUsingCredits) => {
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
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m", // Short-lived access token
    }
  );
};

export const createRefreshToken = (userId, family) => {
  return jwt.sign(
    {
      userId,
      family,
      type: 'refresh',
    },
    process.env.JWT_REFRESH_SECRET || "ofis-square-refresh-secret-key",
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d", // Long-lived refresh token
    }
  );
};

export const generateTokenFamily = () => {
  return crypto.randomBytes(16).toString('hex');
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET || "ofis-square-refresh-secret-key");
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};
