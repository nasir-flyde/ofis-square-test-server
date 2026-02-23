import { createAccessToken, createRefreshToken, generateTokenFamily } from "../middlewares/createJwtRefresh.js";
import { storeRefreshToken, getDeviceInfo } from "../utils/refreshTokenService.js";

/**
 * Generate both access and refresh tokens for a user
 * @param {Object} user - User object
 * @param {Object} role - Role object
 * @param {Object} req - Express request object
 * @param {Object} additionalData - Additional data (clientId, memberId, buildingId, allowedUsingCredits)
 * @returns {Object} - { accessToken, refreshToken }
 */
export const generateAuthTokens = async (user, role, req, additionalData = {}) => {
  const { clientId, memberId, buildingId, allowedUsingCredits, guestId } = additionalData;

  // Create access token (short-lived)
  const accessToken = createAccessToken(
    user._id.toString(),
    user.email,
    role._id.toString(),
    role.roleName,
    user.phone,
    clientId,
    memberId,
    buildingId,
    allowedUsingCredits,
    guestId
  );
  const family = generateTokenFamily();
  const refreshToken = createRefreshToken(user._id.toString(), family);

  // Calculate expiration time
  const expiresIn = parseInt(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS || "604800"); // 7 days in seconds
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // Get device info
  const deviceInfo = getDeviceInfo(req);

  // Store refresh token in database
  await storeRefreshToken(user._id, refreshToken, expiresAt, deviceInfo, family);

  return { accessToken, refreshToken };
};
