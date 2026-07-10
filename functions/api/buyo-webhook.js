/**
 * BUYO Webhook Handler (Cloudflare Pages Functions)
 * Receives lead events from BUYO and sends PURCHASE events to Meta CAPI
 * 
 * POST /api/buyo-webhook
 * Triggered by BUYO postback when lead status changes
 * Converts BUYO lead data → Meta CAPI Purchase event
 */

// Pull the first non-empty value across several possible field names.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

// Best-effort raw log to D1 so we can inspect BUYO's real payload shape.
async function logWebhook(env, row) {
  try {
    if (!env.AUDIT_DB || !env.AUDIT_DB.prepare) return;
    await env.AUDIT_DB.prepare(
      "INSERT INTO webhook_log (source, status, lead_id, fired, capi_http, raw) VALUES (?1,?2,?3,?4,?5,?6)"
    ).bind("buyo", row.status || null, row.lead_id || null, row.fired ? 1 : 0, row.capi_http || null, (row.raw || "").slice(0, 2000)).run();
  } catch (e) { /* never block the webhook */ }
}

// Recover browser identifiers captured at lead time (lead_signals table) so the
// Purchase event carries fbp/fbc/client_ip/client_ua — same person, full match.
import { findLeadSignals } from "../_shared/d1.js";
import { buildFbcFromFbclid, isValidFbc, isValidFbp } from "../_shared/attribution.js";

export const onRequestPost = async ({ request, env }) => {
  let rawText = "";
  let payload = {};
  try {
    rawText = await request.text();
    try { payload = JSON.parse(rawText); } catch { payload = {}; }

    // Tolerant field extraction — BUYO field names are not guaranteed.
    const leadId = pick(payload, ["lead_id", "leadId", "id", "lead", "uuid", "click_id", "clickId", "transaction_id", "order_id"]);
    const statusRaw = pick(payload, ["status", "event", "state", "trigger", "type", "lead_status"]);
    const status = String(statusRaw || "").toLowerCase();
    const phone = pick(payload, ["phone", "phone_number", "tel", "telephone", "customer_phone", "msisdn"]);
    const name = pick(payload, ["name", "full_name", "customer_name", "client_name", "fio"]);
    const email = pick(payload, ["email", "e_mail", "mail"]);
    const order_value = pick(payload, ["order_value", "value", "amount", "sum", "price", "total"]);
    const created_at = pick(payload, ["created_at", "createdAt", "timestamp", "time", "date"]);
    const attrs = (payload.attrs && typeof payload.attrs === "object") ? payload.attrs : {};

    // Negative statuses NEVER fire Purchase (safety net even though the BUYO
    // postback trigger should already filter to confirmed leads only).
    const NEGATIVE = ["reject", "rejected", "declin", "decline", "declined", "trash", "spam", "cancel", "canceled", "cancelled", "hold", "fail", "failed", "invalid", "duplicate"];
    const isNegative = NEGATIVE.some(function (n) { return status.indexOf(n) !== -1; });

    // Need at least one identifier (lead id or phone) to build a stable event.
    if (!leadId && !phone) {
      await logWebhook(env, { status: status, lead_id: null, fired: false, raw: rawText });
      return new Response(JSON.stringify({ ok: false, error: "no_identifier" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    if (isNegative) {
      await logWebhook(env, { status: status, lead_id: leadId, fired: false, raw: rawText });
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "status=" + status }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Fire Purchase. The BUYO postback trigger (set to "Подтверждён" in the
    // dashboard) already restricts delivery to confirmed leads, so any
    // non-negative postback that reaches here is a confirmed sale.
    const capiResult = await sendToMetaCAPI({
      lead_id: leadId, phone, name, email, order_value, created_at, attrs, env,
    });

    await logWebhook(env, { status: status, lead_id: leadId, fired: capiResult.ok, capi_http: capiResult.httpStatus, raw: rawText });

    if (!capiResult.ok) {
      console.error("[BUYO Webhook] Meta CAPI failed:", capiResult.error);
      return new Response(JSON.stringify({ ok: false, error: capiResult.error }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, capi_event_id: capiResult.event_id }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    await logWebhook(env, { status: "exception", lead_id: null, fired: false, raw: rawText || String(err.message) });
    console.error("[BUYO Webhook] Error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
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

/**
 * Send PURCHASE event to Meta CAPI
 */
async function sendToMetaCAPI({ lead_id, phone, name, email, order_value, created_at, attrs, env }) {
  const pixelId = env.META_PIXEL_ID || "2935651803447339";
  const accessToken = env.META_CAPI_ACCESS_TOKEN;

  if (!accessToken) {
    return { ok: false, error: "META_CAPI_ACCESS_TOKEN not configured" };
  }

  // Hash phone and email for Advanced Matching.
  // CRITICAL: phone must be hashed in the SAME canonical form as Lead/IC events
  // (full international digits: 998XXXXXXXXX) or Meta cannot link Purchase to
  // the same person → match quality collapses.
  const phoneCanonical = phone ? normalizePhone(phone) : null;
  const phoneHash = phoneCanonical ? await sha256Hex(phoneCanonical) : null;
  const emailHash = email ? await sha256Hex(String(email).toLowerCase().trim()) : null;

  // Recover browser signals captured at lead time (fbp/fbc/ip/ua/landing_url).
  const signals = await findLeadSignals(env, { leadId: lead_id, phoneHash });

  // Build user_data for Advanced Matching
  const userData = {};

  // Required: hashed PII
  if (phoneHash) userData.ph = [phoneHash];
  if (emailHash) userData.em = [emailHash];
  if (name) userData.fn = [await sha256Hex(String(name).toLowerCase().trim().split(/\s+/)[0])];

  // Browser identifiers (NOT hashed): webhook attrs first, then D1 signals.
  const fbp = (attrs && attrs._fbp) || (signals && signals.fbp) || null;
  const fbc = (attrs && attrs._fbc) || (signals && signals.fbc) || null;
  if (isValidFbp(fbp)) userData.fbp = fbp;
  if (isValidFbc(fbc)) userData.fbc = fbc;
  if (!userData.fbc && signals && signals.fbclid) {
    const rebuilt = buildFbcFromFbclid(String(signals.fbclid).slice(0, 256));
    if (isValidFbc(rebuilt)) userData.fbc = rebuilt;
  }

  // Client info (raw, NOT hashed)
  const clientIp = (attrs && attrs.client_ip) || (signals && signals.client_ip) || null;
  const clientUa = (attrs && attrs.client_ua) || (signals && signals.client_ua) || null;
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUa) userData.client_user_agent = clientUa;

  // country (hashed) — all traffic is Uzbekistan.
  userData.country = [await sha256Hex("uz")];

  // Optional: additional hashed PII for better matching
  if (attrs.ln) userData.ln = [await sha256Hex(String(attrs.ln).toLowerCase().trim())];  // Last name
  if (attrs.ct) userData.ct = [await sha256Hex(String(attrs.ct).toLowerCase().trim())];  // City
  if (attrs.st) userData.st = [await sha256Hex(String(attrs.st).toLowerCase().trim())];  // State
  if (attrs.zp) userData.zp = [await sha256Hex(String(attrs.zp).toLowerCase().trim())];  // Zip code
  if (attrs.country) userData.country = [await sha256Hex(String(attrs.country).toLowerCase().trim())];
  if (attrs.dob) userData.db = [await sha256Hex(String(attrs.dob).replace(/\D/g, ''))];  // DOB YYYYMMDD
  if (attrs.gender) userData.ge = [await sha256Hex(String(attrs.gender).toLowerCase().charAt(0))];

  // Build custom_data (order_value from BUYO may be a string / in different
  // units — parse defensively, fall back to the confirmed SKU price).
  const contentId = env.PRODUCT_CONTENT_ID || "socks-with-toes-v1";
  const defaultValue = Number.parseInt(env.PRODUCT_VALUE_UZS || "135000", 10) || 135000;
  const parsedValue = Number.parseFloat(String(order_value || "").replace(/[^\d.]/g, ""));
  const value = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
  const customData = {
    value: value,
    currency: env.PRODUCT_CURRENCY || "UZS",
    content_name: env.PRODUCT_CONTENT_NAME || "Barmoqli paypoqlar (3 juft)",
    content_ids: [contentId],
    content_type: "product",
    num_items: 1,
    contents: [{ id: contentId, quantity: 1 }],
  };

  // Stable dedup key per lead: lead_id if present, else the phone hash.
  // Retries / duplicate postbacks for the same lead collapse to one Purchase.
  const dedupKey = lead_id ? String(lead_id) : (phoneHash ? phoneHash.slice(0, 24) : null);
  const eventId = "buyo_purchase_" + (dedupKey || Math.floor(Date.now() / 1000));
  // event_time = confirmation time (now). Avoids "event too old/future"
  // rejections from mis-parsed BUYO timestamps.
  const eventTime = Math.floor(Date.now() / 1000);

  // external_id must be a hashed identifier for Advanced Matching.
  if (dedupKey) userData.external_id = [await sha256Hex(String(dedupKey).toLowerCase())];

  const capiPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        event_source_url: (attrs && attrs.landing_url) || (signals && signals.landing_url) || "https://socks.savdomix.uz",
        user_data: userData,
        custom_data: customData,
      },
    ],
    access_token: accessToken,
  };

  console.log("[Meta CAPI] Sending Purchase event:", JSON.stringify(capiPayload, null, 2));

  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(capiPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Meta CAPI] Error response:", result);
      return { ok: false, httpStatus: response.status, error: result.error?.message || "Unknown error" };
    }

    console.log("[Meta CAPI] Success:", result);
    return { ok: true, httpStatus: response.status, event_id: eventId, capi_response: result };
  } catch (err) {
    console.error("[Meta CAPI] Fetch error:", err.message);
    return { ok: false, httpStatus: 0, error: err.message };
  }
}

/**
 * Normalize phone to canonical international digits (998XXXXXXXXX) —
 * MUST match _shared/phone.js normalizePhone so ph hashes are identical
 * across Lead / InitiateCheckout / Purchase events.
 */
function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D+/g, "");
  if (d.startsWith("00998")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("8")) d = d.slice(1);
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  return d.length === 9 ? "998" + d : null;
}

/**
 * SHA256 hash helper
 */
async function sha256Hex(s) {
  const encoder = new TextEncoder();
  const data = encoder.encode(s);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
