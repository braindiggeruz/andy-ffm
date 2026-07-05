// /app/functions/api/track-event.js
// POST /api/track-event — Generic server-side CAPI mirror for top-funnel events
// (PageView, ViewContent) with browser dedup via shared event_id.
//
// The browser fires these via fbq with eventID = client_event_id. This endpoint
// fires the SAME event to Meta CAPI with the identical event_id, so Meta
// deduplicates browser+server into one high-quality event. The server adds
// reliable signals the browser can't guarantee (client IP, full UA, external_id,
// country) — this is what raises Match Quality for PageView/ViewContent.
//
// Allowed events are whitelisted. Lead and InitiateCheckout have their own
// dedicated endpoints (/api/lead, /api/track-ic) and are NOT handled here.

import { sanitizeUrl } from "../_shared/validate.js";
import { buildCapiEventPayload } from "../_shared/meta_capi.js";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_EVENTS = new Set(["PageView", "ViewContent"]);

export const onRequestPost = async ({ request, env }) => {
  let payload = {};
  try { payload = await request.json(); } catch { /* tolerate */ }

  const eventName = (payload.event_name || "").toString();
  if (!ALLOWED_EVENTS.has(eventName)) {
    return jsonResponse({ ok: false, error: "event_not_allowed" }, 400);
  }
  const eventId = (payload.client_event_id || "").toString();
  if (!EVENT_ID_RE.test(eventId)) {
    return jsonResponse({ ok: false, error: "invalid_event_id" }, 400);
  }

  const attrs = (payload.attrs && typeof payload.attrs === "object") ? payload.attrs : {};
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";

  const pixelId = env.META_PIXEL_ID;
  const token = env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return jsonResponse({ ok: true, capi: "skipped" });

  const body = await buildCapiEventPayload(eventName, {
    eventId,
    eventSourceUrl: sanitizeUrl(attrs.landing_url) || (request.headers.get("referer") || ""),
    clientIp: ip,
    clientUa: ua,
    fbp: typeof attrs._fbp === "string" ? attrs._fbp : null,
    fbc: typeof attrs._fbc === "string" ? attrs._fbc : null,
    fbclid: typeof attrs.fbclid === "string" ? attrs.fbclid : null,
    externalId: (payload.external_id || "").toString() || null,
    country: "uz",
    // No phone/name available at PageView/ViewContent — value still forced server-side.
    orderValue: 125000,
    quantity: 1,
  }, env);

  const ver = "v21.0";
  const url = `https://graph.facebook.com/${ver}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  let status = "failed";
  try {
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    status = resp.status >= 200 && resp.status < 300 ? "sent" : "failed";
  } catch { status = "failed"; }

  return jsonResponse({ ok: status === "sent", capi: status });
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
