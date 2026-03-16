import BlacklistedToken from "../models/blacklistedTokenModel.js";
import jwt from "jsonwebtoken";

/**
 * Add a token to the blacklist
 * @param {string} token - The access token to blacklist
 * @param {string} reason - The reason for blacklisting
 */
export const blacklistToken = async (token, reason = "logout") => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      // If token can't be decoded or has no expiry, we still blacklist it but with a default expiry
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
      await BlacklistedToken.findOneAndUpdate(
        { token },
        { token, expiresAt, reason },
        { upsert: true, new: true }
      );
      return;
    }

    const expiresAt = new Date(decoded.exp * 1000);
    
    await BlacklistedToken.findOneAndUpdate(
      { token },
      { token, expiresAt, reason },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error("Error blacklisting token:", error);
    // Don't throw error to avoid breaking the calling flow (e.g., logout)
  }
};

/**
 * Check if a token is blacklisted
 * @param {string} token - The token to check
 * @returns {Promise<boolean>} - True if blacklisted, false otherwise
 */
export const isTokenBlacklisted = async (token) => {
  try {
    const count = await BlacklistedToken.countDocuments({ token });
    return count > 0;
  } catch (error) {
    console.error("Error checking token blacklist:", error);
    return false; // Fail open if database is down? Or fail closed? Usually fail open for auth if db is critical.
  }
};
