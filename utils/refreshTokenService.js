import RefreshToken from "../models/refreshTokenModel.js";
import { createRefreshToken, generateTokenFamily, verifyRefreshToken } from "../middlewares/createJwtRefresh.js";

/**
 * Store refresh token in database
 */
export const storeRefreshToken = async (userId, token, expiresAt, deviceInfo, family) => {
  try {
    const refreshToken = await RefreshToken.create({
      userId,
      token,
      expiresAt,
      deviceInfo,
      family,
    });
    return refreshToken;
  } catch (error) {
    console.error('Error storing refresh token:', error);
    throw error;
  }
};

/**
 * Validate refresh token
 */
export const validateRefreshToken = async (token) => {
  try {
    // Verify JWT signature and expiration
    const decoded = verifyRefreshToken(token);
    
    // Check if token exists in database and is not revoked
    const tokenDoc = await RefreshToken.findOne({
      token,
      userId: decoded.userId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) {
      if (decoded.family) {
        await RefreshToken.revokeFamily(decoded.family);
      }
      throw new Error('Refresh token not found or has been revoked');
    }

    return { decoded, tokenDoc };
  } catch (error) {
    throw error;
  }
};

/**
 * Rotate refresh token (issue new one and revoke old one)
 */
export const rotateRefreshToken = async (oldToken, userId, deviceInfo) => {
  try {
    const { decoded, tokenDoc } = await validateRefreshToken(oldToken);
    
    // Revoke old token
    tokenDoc.isRevoked = true;
    await tokenDoc.save();

    // Generate new refresh token with same family
    const newToken = createRefreshToken(userId, decoded.family);
    const expiresIn = parseInt(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS || "604800"); // 7 days in seconds
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Store new token
    await storeRefreshToken(userId, newToken, expiresAt, deviceInfo, decoded.family);

    return newToken;
  } catch (error) {
    throw error;
  }
};

/**
 * Revoke refresh token
 */
export const revokeRefreshToken = async (token) => {
  try {
    const result = await RefreshToken.updateOne(
      { token },
      { isRevoked: true }
    );
    return result;
  } catch (error) {
    console.error('Error revoking refresh token:', error);
    throw error;
  }
};

/**
 * Revoke all refresh tokens for a user (logout all devices)
 */
export const revokeAllUserTokens = async (userId) => {
  try {
    const result = await RefreshToken.revokeAllForUser(userId);
    return result;
  } catch (error) {
    console.error('Error revoking all user tokens:', error);
    throw error;
  }
};

/**
 * Get device info from request
 */
export const getDeviceInfo = (req) => {
  return {
    userAgent: req.headers['user-agent'] || 'Unknown',
    ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
  };
};

/**
 * Cleanup expired tokens (can be run as a cron job)
 */
export const cleanupExpiredTokens = async () => {
  try {
    const result = await RefreshToken.cleanupExpired();
    console.log(`Cleaned up ${result.deletedCount} expired refresh tokens`);
    return result;
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
    throw error;
  }
};
