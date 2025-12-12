// utils/matrixApi.js
import axios from "axios";
import { Buffer } from "buffer";
import apiLogger from "./apiLogger.js";

const BASE_URL = process.env.COSEC_API_BASE || "";
const USER = process.env.COSEC_API_USER || "";
const PASS = process.env.COSEC_API_PASS || "";
const TIMEOUT = parseInt(process.env.COSEC_API_TIMEOUT_MS || "10000", 10);
const MAX_RETRIES = parseInt(process.env.COSEC_API_MAX_RETRIES || "2", 10);
const RETRY_BACKOFF_MS = parseInt(process.env.COSEC_API_RETRY_BACKOFF_MS || "300", 10);

const authHeader = USER && PASS ? "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") : undefined;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT,
  headers: {
    ...(authHeader ? { Authorization: authHeader } : {}),
    "Content-Type": "application/json",
  },
});

async function requestWithRetry(fn, { maxRetries = MAX_RETRIES, backoffMs = RETRY_BACKOFF_MS } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const status = err?.response?.status;
      const retriable = !status || (status >= 500 && status < 600);
      if (attempt > maxRetries || !retriable) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, backoffMs * attempt));
    }
  }
}

function buildHeadersForLog() {
  const headers = { ...(client.defaults.headers || {}) };
  const auth = headers["Authorization"] || headers?.common?.["Authorization"];
  const ct = headers["Content-Type"] || headers?.common?.["Content-Type"] || "application/json";
  const accept = headers["Accept"] || headers?.common?.["Accept"] || "application/json";
  return { Authorization: auth, "Content-Type": ct, Accept: accept };
}

function isMatrixSuccess(body) {
  if (body == null) return false;
  if (typeof body === "object") {
    if (body.success === false) return false;
    if (typeof body.status === "string" && body.status.toLowerCase() === "failed") return false;
    if (typeof body.error === "string" && body.error) return false;
    if (typeof body.message === "string" && /invalid|error|failed/i.test(body.message)) return false;
    if (typeof body.code === "string" && /\d{6,}/.test(body.code)) return false;
    return true;
  }
  if (typeof body === "string") {
    const text = body.toLowerCase();
    if (text.includes("invalid personal email") || text.includes("0070201004") || text.includes("failed") || text.includes("error")) {
      return false;
    }
    return true;
  }
  return true;
}

// Format access validity date to DDMMYYYY (e.g., 31122025)
function formatAccessValidityDate(dateLike) {
  if (!dateLike) return undefined;
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return undefined;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function buildQuery({ id, name, email, phone, status, emailField, branch, accessValidityDate }) {
  const enc = (v) => encodeURIComponent(String(v));
  const encEmail = (v) => encodeURIComponent(String(v)).replace(/%40/gi, "@");
  const active = status === "inactive" ? 0 : 1; // default to active

  const qp = [
    `action=set`,
    `id=${enc(String(id))}`,
    name ? `name=${enc(String(name))}` : null,
    `module=U`,
    emailField && email ? `${emailField}=${encEmail(email)}` : null,
    phone ? `personal-cell=${enc(String(phone))}` : null,
    `active=${active}`,
    branch ? `branch=${enc(String(branch))}` : null,
    accessValidityDate ? `access-validity-date=${enc(String(accessValidityDate))}` : null,
  ]
    .filter(Boolean)
    .join(";");

  return qp;
}

async function loggedGet(url, operation = "user.set") {
  const logHeaders = buildHeadersForLog();
  const requestId = await apiLogger.logOutgoingCall({
    service: "matrix",
    operation,
    method: "GET",
    url: url,
    headers: logHeaders,
    requestBody: null,
    maxAttempts: 1,
  });
  try {
    const res = await requestWithRetry(() => client.get(url));
    await apiLogger.logResponse({
      requestId,
      statusCode: res.status,
      responseHeaders: res.headers || {},
      responseBody: res.data,
      success: res.status >= 200 && res.status < 300,
    });
    const ok = res.status >= 200 && res.status < 300 && isMatrixSuccess(res.data);
    return { ok, data: res.data, status: res.status };
  } catch (err) {
    const status = err?.response?.status || 0;
    const respHeaders = err?.response?.headers || {};
    const respData = err?.response?.data || { message: err?.message };
    await apiLogger.logResponse({
      requestId,
      statusCode: status,
      responseHeaders: respHeaders,
      responseBody: respData,
      success: false,
      errorMessage: err?.message,
    });
    return { ok: false, status, data: respData };
  }
}

async function loggedPostJson(url, data, params, operation = "user.set.post") {
  const logHeaders = buildHeadersForLog();
  const requestId = await apiLogger.logOutgoingCall({
    service: "matrix",
    operation,
    method: "POST",
    url: url,
    headers: logHeaders,
    requestBody: data,
    maxAttempts: 1,
  });
  try {
    const res = await requestWithRetry(() => client.post(url, data, { params }));
    await apiLogger.logResponse({
      requestId,
      statusCode: res.status,
      responseHeaders: res.headers || {},
      responseBody: res.data,
      success: res.status >= 200 && res.status < 300,
    });
    const ok = res.status >= 200 && res.status < 300 && isMatrixSuccess(res.data);
    return { ok, data: res.data, status: res.status };
  } catch (err) {
    const status = err?.response?.status || 0;
    const respHeaders = err?.response?.headers || {};
    const respData = err?.response?.data || { message: err?.message };
    await apiLogger.logResponse({
      requestId,
      statusCode: status,
      responseHeaders: respHeaders,
      responseBody: respData,
      success: false,
      errorMessage: err?.message,
    });
    return { ok: false, status, data: respData };
  }
}

export const matrixApi = {
  // Create or upsert a user in Matrix COSEC (v2 semicolon query format preferred)
  async createUser(payload) {
    if (!BASE_URL || !authHeader) {
      throw new Error("Matrix API not configured: missing COSEC_API_BASE/COSEC_API_USER/COSEC_API_PASS");
    }

    const { id, name, email, phone, status, branch = 3, contractEndDate, accessValidityDate: accessValidityDateRaw } = payload || {};
    if (!id) throw new Error("matrixApi.createUser: id is required");
    const normEmail = typeof email === "string" && email.trim() ? String(email).trim().toLowerCase() : undefined;

    // Decide access-validity-date (DDMMYYYY)
    const accessValidityDate = formatAccessValidityDate(accessValidityDateRaw || contractEndDate);

    // Try GET with personal-email first
    const qpPersonal = buildQuery({ id, name, email: normEmail, phone, status, emailField: normEmail ? "personal-email" : null, branch, accessValidityDate });
    const first = await loggedGet(`/user?${qpPersonal}`, "user.set.personal-email");
    if (first.ok) return first.data;

    // If email present and server complains about personal email, try official-email
    if (normEmail) {
      const qpOfficial = buildQuery({ id, name, email: normEmail, phone, status, emailField: "official-email", branch, accessValidityDate });
      const second = await loggedGet(`/user?${qpOfficial}`, "user.set.official-email");
      if (second.ok) return second.data;

      // Try generic 'email' as third option
      const qpGeneric = buildQuery({ id, name, email: normEmail, phone, status, emailField: "email", branch, accessValidityDate });
      const third = await loggedGet(`/user?${qpGeneric}`, "user.set.email");
      if (third.ok) return third.data;

      // Last resort: omit email entirely
      const qpNoEmail = buildQuery({ id, name, email: null, phone, status, emailField: null, branch, accessValidityDate });
      const fourth = await loggedGet(`/user?${qpNoEmail}`, "user.set.no-email");
      if (fourth.ok) return fourth.data;
    }

    // Fallback POST JSON
    const postParams = { action: "set", branch };
    if (accessValidityDate) postParams["access-validity-date"] = accessValidityDate;
    const post = await loggedPostJson(`/user`, { id, name, email: normEmail, phone, status }, postParams, "user.set.post");
    if (post.ok) return post.data;

    // If all attempts failed, throw last error object for caller to handle
    throw new Error(`Matrix createUser failed. See ApiCallLog for details. lastStatus=${post.status || "unknown"}`);
  },

  // Assign a Matrix user to a specific device by its device_id
  async assignUserToDevice({ device_id, externalUserId }) {
    if (!BASE_URL || !authHeader) {
      throw new Error("Matrix API not configured: missing COSEC_API_BASE/COSEC_API_USER/COSEC_API_PASS");
    }
    if (!device_id || !externalUserId) {
      throw new Error("matrixApi.assignUserToDevice requires device_id and externalUserId");
    }

    const qp = `action=assign;device=${encodeURIComponent(device_id)};id=${encodeURIComponent(externalUserId)}`;
    const url = `/device?${qp}`;
    const res = await loggedGet(url, "device.assign");
    return res;
  },

  // Revoke a Matrix user's access from a specific device by its device_id
  async revokeUserFromDevice({ device_id, externalUserId }) {
    if (!BASE_URL || !authHeader) {
      throw new Error("Matrix API not configured: missing COSEC_API_BASE/COSEC_API_USER/COSEC_API_PASS");
    }
    if (!device_id || !externalUserId) {
      throw new Error("matrixApi.revokeUserFromDevice requires device_id and externalUserId");
    }
    const qp = `action=revoke;device=${encodeURIComponent(device_id)};id=${encodeURIComponent(externalUserId)}`;
    const url = `/device?${qp}`;
    const res = await loggedGet(url, "device.revoke");
    return res;
  },

  // Enroll a card for a Matrix user on a specific device
  async enrollCardToDevice({ externalUserId, device, device_id, deviceType = 16, enrollType = "card", enrollCount = 1 }) {
    if (!BASE_URL || !authHeader) {
      throw new Error("Matrix API not configured: missing COSEC_API_BASE/COSEC_API_USER/COSEC_API_PASS");
    }
    const deviceParam = (typeof device === 'number' && Number.isFinite(device)) ? device : device_id;
    if (!externalUserId || (deviceParam === undefined || deviceParam === null || deviceParam === '')) {
      throw new Error("matrixApi.enrollCardToDevice requires externalUserId and device (numeric) or device_id");
    }

    const qp = [
      `action=enroll`,
      `id=${encodeURIComponent(externalUserId)}`,
      `device-type=${encodeURIComponent(String(deviceType))}`,
      `device-id=${encodeURIComponent(String(deviceParam))}`,
      `enroll-type=${encodeURIComponent(enrollType)}`,
      `enroll-count=${encodeURIComponent(String(enrollCount))}`,
    ].join(";");
    const url = `/user?${qp}`;
    const res = await loggedGet(url, "user.enroll.card");
    return res;
  },

  // Set a credential (card) on a Matrix user using card UID
  async setCardCredential({ externalUserId, data }) {
    if (!BASE_URL || !authHeader) {
      throw new Error("Matrix API not configured: missing COSEC_API_BASE/COSEC_API_USER/COSEC_API_PASS");
    }
    if (!externalUserId) throw new Error("matrixApi.setCardCredential requires externalUserId");
    if (!data) throw new Error("matrixApi.setCardCredential requires data (cardUid)");

    const qp = [
      `action=set-credential`,
      `id=${encodeURIComponent(String(externalUserId))}`,
      `credential-type=card`,
      `data=${encodeURIComponent(String(data))}`,
    ].join(";");
    const url = `/user?${qp}`;
    const res = await loggedGet(url, "user.set-credential.card");
    return res;
  },

  // Expand here with more endpoints when needed
  // async setCredential({ id, type, data, facilityCode }) { ... }
  // async assign({ id, devices }) { ... }
  // async revoke({ id, devices }) { ... }
};

export default matrixApi;
