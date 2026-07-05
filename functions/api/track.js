// /app/functions/api/track.js
// POST /api/track — lightweight first-party telemetry (NO PII).
// Accepts JSON: { event, ts, page, attrs (utm/fbclid/_fbp/_fbc), event_id?, error_code? }
// Writes nothing if AUDIT_DB binding missing.

import { sha256Hex } from "../_shared/hash.js";
import { ipPrefix, referrerHost } from "../_shared/attribution.js";

const ALLOWED_EVENTS = new Set([
  "landing_view",
  "hero_cta_click",
  "form_view",
  "form_start",
  "valid_submit",
  "api_started",
  "buyo_accepted",
  "buyo_rejected",
  "lead_success",
  "api_error",
  "mock_valid_submit",
  "mock_buyo_accepted",
  "mock_lead_would_fire",
  "mock_capi_would_fire",
]);

export const onRequestPost = async ({ request, env }) => {
  let payload = {};
  try { payload = await request.json(); } catch { /* ignore */ }
  const event = String(payload.event || "").slice(0, 64);
  if (!ALLOWED_EVENTS.has(event)) {
    return new Response(JSON.stringify({ ok: false, error: "bad_event" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }
  // We don't persist generic telemetry to D1 by default (cost + privacy).
  // Cloudflare access log + console.log is sufficient for debugging funnels.
  // (Logs scrubbed: no PII.)
  const ip = request.headers.get("CF-Connecting-IP") || "";
  console.log(JSON.stringify({
    ev: event,
    ts: Date.now(),
    page: String(payload.page || "").slice(0, 200),
    ip_prefix: ipPrefix(ip),
    referrer_host: referrerHost(request.headers.get("referer")),
    eid: typeof payload.event_id === "string" ? payload.event_id.slice(0, 64) : null,
    attrs: payload.attrs && typeof payload.attrs === "object" ? {
      utm_source: String(payload.attrs.utm_source || "").slice(0, 80) || null,
      utm_campaign: String(payload.attrs.utm_campaign || "").slice(0, 80) || null,
      placement: String(payload.attrs.placement || "").slice(0, 40) || null,
      fbclid_hash: payload.attrs.fbclid ? (await sha256Hex(payload.attrs.fbclid)).slice(0, 12) : null,
    } : null,
  }));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
};

export const onRequestOptions = () =>
  new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
