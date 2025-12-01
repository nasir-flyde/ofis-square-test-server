import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import os from "os";

// Load environment variables
dotenv.config();

// Token file storage
const DEFAULT_TOKENS_FILE = path.join(os.tmpdir(), "ofis-square-zoho-tokens.json");
const LEGACY_TOKENS_FILE = path.join(process.cwd(), "zoho-tokens.json");
const TOKEN_FILE_PATH = process.env.ZOHO_TOKENS_FILE || DEFAULT_TOKENS_FILE;

const CLIENT_ID = process.env.ZOHO_BOOKS_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_BOOKS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ZOHO_BOOKS_REFRESH_TOKEN;

let tokenData = {
  access_token: null,
  expires_at: null,
  refresh_token: REFRESH_TOKEN
};

async function loadTokens() {
  try {
    const data = await fs.readFile(TOKEN_FILE_PATH, 'utf8');
    tokenData = { ...tokenData, ...JSON.parse(data) };
    console.log(`Loaded Zoho token from: ${TOKEN_FILE_PATH}`);
  } catch (error) {
    try {
      const legacy = await fs.readFile(LEGACY_TOKENS_FILE, 'utf8');
      tokenData = { ...tokenData, ...JSON.parse(legacy) };
      console.log(`Loaded Zoho token from legacy path: ${LEGACY_TOKENS_FILE}`);
      await saveTokens();
      console.log(`Migrated Zoho token to: ${TOKEN_FILE_PATH}`);
    } catch (_) {
      console.log("No existing token file found, will create new one on first refresh");
    }
  }
}

async function saveTokens() {
  try {
    try { await fs.mkdir(path.dirname(TOKEN_FILE_PATH), { recursive: true }); } catch (_) {}
    await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(tokenData, null, 2));
    console.log(`Saved Zoho token to: ${TOKEN_FILE_PATH}`);
  } catch (error) {
    console.error("Failed to save tokens:", error.message);
  }
}

function isTokenValid() {
  if (!tokenData.access_token || !tokenData.expires_at) {
    return false;
  }
  
  try {
    const now = Date.now();
    const expiresAt = new Date(tokenData.expires_at).getTime();
    if (isNaN(expiresAt)) {
      console.warn("Invalid expiration date format, treating token as expired");
      return false;
    }
    
    const bufferTime = 5 * 60 * 1000;
    
    return (expiresAt - now) > bufferTime;
  } catch (error) {
    console.warn("Error checking token validity:", error.message);
    return false;
  }
}

async function refreshAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET || !tokenData.refresh_token) {
    throw new Error("Missing OAuth credentials. Please set ZOHO_BOOKS_CLIENT_ID, ZOHO_BOOKS_CLIENT_SECRET, and ZOHO_BOOKS_REFRESH_TOKEN environment variables.");
  }

  const url = "https://accounts.zoho.in/oauth/v2/token";
  const params = new URLSearchParams({
    refresh_token: tokenData.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token"
  });

  try {
    console.log("🔄 Refreshing Zoho access token...");
    console.log("Request URL:", url);
    console.log("Request params:", params.toString());
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    console.log("Response status:", response.status, response.statusText);
    
    const responseText = await response.text();
    console.log("Raw response:", responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`Token refresh failed (${response.status}): ${data.error || data.message || response.statusText}`);
    }

    console.log("Token refresh response data:", data);

    if (!data.access_token) {
      throw new Error("No access_token in response");
    }
    tokenData.access_token = data.access_token;
    const expiresInSeconds = parseInt(data.expires_in) || 3600; // Default to 1 hour if invalid
    const expirationDate = new Date(Date.now() + (expiresInSeconds * 1000));
    tokenData.expires_at = expirationDate.toISOString();
    
    console.log("Token expires at:", tokenData.expires_at);
    
    // Save to file
    await saveTokens();
    
    console.log("✅ Zoho access token refreshed successfully");
    return tokenData.access_token;

  } catch (error) {
    console.error("❌ Failed to refresh Zoho access token:", error.message);
    console.error("Error details:", error);
    throw error;
  }
}

export async function getValidAccessToken() {
  if (!tokenData.access_token && !tokenData.expires_at) {
    await loadTokens();
  }
  if (isTokenValid()) {
    return tokenData.access_token;
  }
  return await refreshAccessToken();
}

export async function initializeWithToken(accessToken, expiresInSeconds = 3600) {
  if (!accessToken) {
    throw new Error("Access token is required for initialization");
  }
  
  const validExpiresIn = parseInt(expiresInSeconds) || 3600;
  tokenData.access_token = accessToken;
  tokenData.expires_at = new Date(Date.now() + (validExpiresIn * 1000)).toISOString();
  await saveTokens();
  console.log("✅ Token manager initialized with existing token");
}

export async function clearTokens() {
  tokenData = {
    access_token: null,
    expires_at: null,
    refresh_token: REFRESH_TOKEN
  };
  try {
    await fs.unlink(TOKEN_FILE_PATH);
  } catch (error) {
  }
  console.log("🗑️ Tokens cleared");
}

export function getTokenInfo() {
  return {
    hasToken: !!tokenData.access_token,
    expiresAt: tokenData.expires_at,
    isValid: isTokenValid(),
    maskedToken: tokenData.access_token ? `${tokenData.access_token.slice(0, 8)}...` : null
  };
}
