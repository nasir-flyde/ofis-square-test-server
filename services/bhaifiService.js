import axios from "axios";

const BASE_URL = process.env.BHAIFI_BASE_URL || "https://test.api.firewallx.ai/v2";
const API_KEY = process.env.BHAIFI_API_KEY || "";

const http = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "X-BHAIFI-KEY": API_KEY,
  },
  timeout: 20000,
});

const safeJson = (obj) => {
  try { return JSON.stringify(obj); } catch { return String(obj); }
};

const ensureEnabled = () => {
  if (!API_KEY) {
    const err = new Error("Bhaifi API not configured: missing BHAIFI_API_KEY");
    err.code = "BHAIFI_DISABLED";
    throw err;
  }
};

export const bhaifiCreateUser = async ({ email, idType = 1, name, nasId, userName }) => {
  ensureEnabled();
  const payload = { email, idType: String(idType ?? '1'), name, nasId, userName };
  try {
    const res = await http.post("/user", payload);
    return { ok: true, data: res.data, payload };
  } catch (e) {
    console.error("[BHAIFI][HTTP] POST /user failed", {
      payload,
      message: e?.message,
      status: e?.response?.status,
      data: e?.response?.data,
      dataJson: safeJson(e?.response?.data),
      firstError: Array.isArray(e?.response?.data?.errors) ? e?.response?.data?.errors[0] : null,
    });
    throw e;
  }
};

export const bhaifiWhitelist = async ({ nasId, startDate, endDate, userName }) => {
  ensureEnabled();
  const path = `/${encodeURIComponent(nasId)}/whitelist`;
  const payload = { startDate, endDate, userName };
  try {
    const res = await http.post(path, payload);
    return { ok: true, data: res.data, payload };
  } catch (e) {
    console.error("[BHAIFI][HTTP] POST /:nasId/whitelist failed", {
      path,
      payload,
      message: e?.message,
      status: e?.response?.status,
      data: e?.response?.data,
      dataJson: safeJson(e?.response?.data),
      firstError: Array.isArray(e?.response?.data?.errors) ? e?.response?.data?.errors[0] : null,
    });
    throw e;
  }
};

export const bhaifiDewhitelist = async ({ nasId, userName }) => {
  ensureEnabled();
  const path = `/${encodeURIComponent(nasId)}/whitelist`;
  const payload = { userName };
  try {
    // Axios supports body with DELETE via the `data` option
    const res = await http.delete(path, { data: payload });
    return { ok: true, data: res.data, payload };
  } catch (e) {
    console.error("[BHAIFI][HTTP] DELETE /:nasId/whitelist failed", {
      path,
      payload,
      message: e?.message,
      status: e?.response?.status,
      data: e?.response?.data,
      dataJson: safeJson(e?.response?.data),
      firstError: Array.isArray(e?.response?.data?.errors) ? e?.response?.data?.errors[0] : null,
    });
    throw e;
  }
};
