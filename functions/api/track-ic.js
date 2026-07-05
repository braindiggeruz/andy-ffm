// /app/functions/api/track-ic.js
// POST /api/track-ic — Server-side InitiateCheckout (CAPI) with browser dedup.
//
// The browser fires InitiateCheckout via fbq with eventID = client_event_id.
// This endpoint fires the SAME event to Meta CAPI using the identical event_id,
// so Meta deduplicates browser+server into one high-quality event. This recovers
// the ~30-50% of InitiateCheckout events lost to iOS/ATT/ITP browser blocking,
// which speeds up ad learning when optimizing for "Начало оформления".
//
// Value/currency are forced server-side to the confirmed SKU (125 000 UZS).
// This event is fired BEFORE BUYO submission (it is the checkout intent signal),
// so it intentionally does NOT depend on a BUYO accept.

import { sanitizeUrl, sanitizeUtm } from "../_shared/validate.js";
import { normalizePhone } from "../_shared/phone.js";
import { sendCapiInitiateCheckout } from "../_shared/meta_capi.js";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestPost = async ({ request, env }) => {
  let payload = {};
  try { payload = await request.json(); } catch { /* tolerate */ }

  const eventId = (payload.client_event_id || "").toString();
  if (!EVENT_ID_RE.test(eventId)) {
    return jsonResponse({ ok: false, error: "invalid_event_id" }, 400);
  }

  const attrs = (payload.attrs && typeof payload.attrs === "object") ? payload.attrs : {};
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";

  // Phone/name are optional here (IC is intent, may fire before clean phone),
  // but if present they improve match quality.
  const phoneCanonical = payload.phone ? normalizePhone(payload.phone.toString()) : null;
  const firstName = (payload.name || "").toString().trim().split(/\s+/)[0] || null;

  const result = await sendCapiInitiateCheckout({
    eventId,
    eventSourceUrl: sanitizeUrl(attrs.landing_url) || (request.headers.get("referer") || ""),
    clientIp: ip,
    clientUa: ua,
    fbp: typeof attrs._fbp === "string" ? attrs._fbp : null,
    fbc: typeof attrs._fbc === "string" ? attrs._fbc : null,
    fbclid: typeof attrs.fbclid === "string" ? attrs.fbclid : null,
    phoneCanonical,
    firstName,
    email: (payload.email || "").toString() || null,
    externalId: (payload.external_id || "").toString() || null,
    country: "uz",
    orderValue: payload.order_value,
    quantity: payload.quantity,
  }, env);

  return jsonResponse({ ok: result.status === "sent" || result.status === "skipped", capi: result.status });
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
