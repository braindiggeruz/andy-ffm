// /app/functions/_shared/buyo.js
// BUYO API adapter — real + mock with identical normalized return shape.
//
// Real shape (POST https://api.buyo.network/api/v1/leads):
//   Authorization: Bearer <token>
//   Content-Type:  application/x-www-form-urlencoded
//   Body:          flow_id, name, phone, ip, utm_*
//   Response:      { success: bool, data?: { id, ... }, message?, errors? }
//
// Normalized return:
//   {
//     accepted: boolean,
//     mode: "real" | "mock",
//     leadId: string | null,
//     statusCode: number,
//     errorCode: string | null
//   }

import { formatPhoneDisplay } from "./phone.js";

function randomMockId() {
  const hex = crypto.getRandomValues(new Uint8Array(6));
  return "mock_" + Array.from(hex, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function submitBuyoMock(_payload, _env) {
  // Deterministic shape — do NOT contact BUYO.
  return {
    accepted: true,
    mode: "mock",
    leadId: randomMockId(),
    statusCode: 200,
    errorCode: null,
  };
}

export async function submitBuyoReal(payload, env) {
  const base = (env.BUYO_API_BASE || "https://api.buyo.network").replace(/\/+$/, "");
  const token = env.BUYO_API_TOKEN;
  if (!token) {
    return { accepted: false, mode: "real", leadId: null, statusCode: 0, errorCode: "missing_token" };
  }
  // BUYO requires international phone (+998...). We have canonical 998... ; add +.
  const phoneForBuyo = payload.phoneCanonical ? "+" + payload.phoneCanonical : null;
  if (!payload.flowId || !payload.name || !phoneForBuyo || !payload.ip) {
    return { accepted: false, mode: "real", leadId: null, statusCode: 422, errorCode: "missing_fields" };
  }
  const form = new URLSearchParams();
  form.set("flow_id", payload.flowId);
  form.set("name", payload.name);
  form.set("phone", phoneForBuyo);
  form.set("ip", payload.ip);
  if (payload.utm_source) form.set("utm_source", payload.utm_source);
  if (payload.utm_medium) form.set("utm_medium", payload.utm_medium);
  if (payload.utm_campaign) form.set("utm_campaign", payload.utm_campaign);
  if (payload.utm_term) form.set("utm_term", payload.utm_term);
  if (payload.utm_content) form.set("utm_content", payload.utm_content);

  let resp;
  try {
    resp = await fetch(`${base}/api/v1/leads`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "savdomix-cf-pages/1.0",
      },
      body: form.toString(),
    });
  } catch (e) {
    return { accepted: false, mode: "real", leadId: null, statusCode: 0, errorCode: "network_error" };
  }

  const status = resp.status;
  let body = null;
  try { body = await resp.json(); } catch { /* ignore parse error */ }

  if (status >= 200 && status < 300 && body && body.success === true) {
    const leadId = body.data && (body.data.id || body.data.lead_id || null);
    return { accepted: true, mode: "real", leadId: leadId || null, statusCode: status, errorCode: null };
  }

  // Distinguish a few error classes for the audit log.
  let errorCode = "buyo_error";
  if (status === 401 || status === 403) errorCode = "auth";
  else if (status === 422) errorCode = "validation";
  else if (status === 429) errorCode = "rate_limit";
  else if (status >= 500) errorCode = "buyo_5xx";
  return { accepted: false, mode: "real", leadId: null, statusCode: status, errorCode };
}

export async function submitBuyo(payload, env) {
  const mockMode = String(env.BUYO_MOCK_MODE || "false").toLowerCase() === "true";
  return mockMode ? submitBuyoMock(payload, env) : submitBuyoReal(payload, env);
}

// Helper for human-readable phone in confirmation screens (no PII server-side).
export { formatPhoneDisplay };
