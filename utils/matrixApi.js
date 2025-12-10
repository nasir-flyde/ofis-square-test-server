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

function buildQuery({ id, name, email, phone, status, emailField }) {
  const enc = (v) => encodeURIComponent(String(v));
  // Preserve '@' in email while safely encoding other characters
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

    const { id, name, email, phone, status } = payload || {};
    if (!id) throw new Error("matrixApi.createUser: id is required");
    const normEmail = typeof email === "string" && email.trim() ? String(email).trim().toLowerCase() : undefined;

    // Try GET with personal-email first
    const qpPersonal = buildQuery({ id, name, email: normEmail, phone, status, emailField: normEmail ? "personal-email" : null });
    const first = await loggedGet(`/user?${qpPersonal}`, "user.set.personal-email");
    if (first.ok) return first.data;

    // If email present and server complains about personal email, try official-email
    if (normEmail) {
      const qpOfficial = buildQuery({ id, name, email: normEmail, phone, status, emailField: "official-email" });
      const second = await loggedGet(`/user?${qpOfficial}`, "user.set.official-email");
      if (second.ok) return second.data;

      // Try generic 'email' as third option
      const qpGeneric = buildQuery({ id, name, email: normEmail, phone, status, emailField: "email" });
      const third = await loggedGet(`/user?${qpGeneric}`, "user.set.email");
      if (third.ok) return third.data;

      // Last resort: omit email entirely
      const qpNoEmail = buildQuery({ id, name, email: null, phone, status, emailField: null });
      const fourth = await loggedGet(`/user?${qpNoEmail}`, "user.set.no-email");
      if (fourth.ok) return fourth.data;
    }

    // Fallback POST JSON
    const post = await loggedPostJson(`/user`, { id, name, email: normEmail, phone, status }, { action: "set" }, "user.set.post");
    if (post.ok) return post.data;

    // If all attempts failed, throw last error object for caller to handle
    throw new Error(`Matrix createUser failed. See ApiCallLog for details. lastStatus=${post.status || "unknown"}`);
  },

  // Expand here with more endpoints when needed
  // async setCredential({ id, type, data, facilityCode }) { ... }
  // async assign({ id, devices }) { ... }
  // async revoke({ id, devices }) { ... }
};

export default matrixApi;
