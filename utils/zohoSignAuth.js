import fetch from "node-fetch";

let cached = {
  accessToken: null,
  expiresAt: 0, // ms epoch
};

function getTokenEndpoint() {
  const dc = process.env.ZOHO_DC || "accounts.zoho.in"; // e.g., accounts.zoho.in, accounts.zoho.com, accounts.zoho.eu
  return `https://${dc}/oauth/v2/token`;
}

export async function getAccessToken() {
  const now = Date.now();
  if (cached.accessToken && cached.expiresAt - now > 60 * 1000) {
    return cached.accessToken;
  }

  // IMPORTANT: Use a dedicated Zoho Sign refresh token generated with Zoho Sign scopes.
  // Do NOT fallback to Books/Generic tokens as scopes won't include Zoho Sign and will cause 9040 Invalid Oauth Scope.
  const refresh_token = process.env.ZOHO_SIGN_REFRESH_TOKEN;
  const client_id = process.env.ZOHO_CLIENT_ID;
  const client_secret = process.env.ZOHO_CLIENT_SECRET;

  if (!refresh_token || !client_id || !client_secret) {
    throw new Error(
      "Zoho OAuth env vars missing. Ensure ZOHO_SIGN_REFRESH_TOKEN, ZOHO_CLIENT_ID, and ZOHO_CLIENT_SECRET are set. ZOHO_SIGN_REFRESH_TOKEN must be generated with scopes: ZohoSign.documents.ALL and ZohoSign.organization.READ (and any other required Zoho Sign scopes)."
    );
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refresh_token);
  params.append("client_id", client_id);
  params.append("client_secret", client_secret);

  const resp = await fetch(getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    const msg = json?.error || json?.message || `HTTP ${resp.status}`;
    throw new Error(`Failed to refresh Zoho access token: ${msg}`);
  }

  cached.accessToken = json.access_token;
  // expires_in is in seconds; be conservative and subtract 60s
  const ttlMs = Math.max(0, (json.expires_in || 3600) - 60) * 1000;
  cached.expiresAt = Date.now() + ttlMs;
  return cached.accessToken;
}
