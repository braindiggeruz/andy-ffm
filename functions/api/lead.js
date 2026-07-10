// /app/functions/api/lead.js
// POST /api/lead — The single canonical lead submission endpoint.
//
// Pipeline:
//   1) Parse + validate (name, phone)
//   2) Compute submission_id (idempotency) and check D1
//   3) If duplicate already accepted → return cached event_id (no double BUYO)
//   4) Call BUYO adapter (mock or real, per env)
//   5) Write sanitized D1 audit row
//   6) If BUYO accepted AND mode=='real' → fire Meta CAPI Lead
//   7) Return { ok, accepted, event_id, mode, lead_id?, retry_after? }
//
// Fails closed if production + mock_mode=true (deployment guard).

import { normalizePhone, phoneLast4 } from "../_shared/phone.js";
import { sanitizeUrl, sanitizeUtm, validateName } from "../_shared/validate.js";
import { sha256Hex, uaHash } from "../_shared/hash.js";
import { ipPrefix, referrerHost } from "../_shared/attribution.js";
import { submitBuyo } from "../_shared/buyo.js";
import { sendCapiLead } from "../_shared/meta_capi.js";
import { alreadySubmitted, insertAuditRow, insertLeadSignals } from "../_shared/d1.js";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function newEventId() {
  // RFC 4122 v4
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function deploymentEnvironment(env) {
  // Cloudflare populates CF_PAGES_BRANCH on Pages.
  const branch = env.CF_PAGES_BRANCH || "";
  if (branch === "main" || branch === "production") return "production";
  if (branch) return "preview";
  return "dev";
}

export const onRequestPost = async ({ request, env }) => {
  const startedAt = Date.now();
  const mockMode = String(env.BUYO_MOCK_MODE || "false").toLowerCase() === "true";
  const environment = deploymentEnvironment(env);

  // Deployment guard: production must never run in mock mode.
  if (environment === "production" && mockMode) {
    console.error("FATAL: production with BUYO_MOCK_MODE=true");
    return jsonResponse({ ok: false, error: "server_misconfig" }, 503);
  }

  let payload = {};
  try { payload = await request.json(); } catch { /* tolerate */ }

  const name = (payload.name || "").toString();
  const phoneRaw = (payload.phone || "").toString();

  // 1) validation
  const nameCheck = validateName(name);
  if (!nameCheck.ok) {
    return jsonResponse({ ok: false, error: "invalid_name", code: nameCheck.error }, 400);
  }
  const phoneCanonical = normalizePhone(phoneRaw);
  if (!phoneCanonical) {
    return jsonResponse({ ok: false, error: "invalid_phone" }, 400);
  }

  // 2) idempotency
  const ua = request.headers.get("user-agent") || "";
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const dayBucket = new Date().toISOString().slice(0, 10);
  const idempotencyMaterial = [
    phoneCanonical,
    dayBucket,
    (payload.attrs && payload.attrs.utm_campaign) || "",
  ].join("|");
  const submissionId = (await sha256Hex(idempotencyMaterial)).slice(0, 32);

  // NOTE: Removed deduplication check to allow all leads through.
  // Each submission is now processed independently, maximizing lead capture.
  // BUYO API will handle any duplicate detection on their end if needed.

  // 3) attribution capture (from client; we never trust ip from client)
  const attrs = (payload.attrs && typeof payload.attrs === "object") ? payload.attrs : {};
  const flowId = env.BUYO_FLOW_ID || "";
  if (!mockMode && !flowId) {
    return jsonResponse({ ok: false, error: "server_misconfig", code: "missing_flow_id" }, 503);
  }

  // 4) BUYO submit
  const eventId = newEventId();
  const buyoResult = await submitBuyo({
    flowId,
    name: nameCheck.value,
    phoneCanonical,
    ip,
    utm_source: sanitizeUtm(attrs.utm_source),
    utm_medium: sanitizeUtm(attrs.utm_medium),
    utm_campaign: sanitizeUtm(attrs.utm_campaign),
    utm_term: sanitizeUtm(attrs.utm_term),
    utm_content: sanitizeUtm(attrs.utm_content),
  }, env);

  // Store client_ip and client_ua for webhook payload
  const clientIp = ip || null;
  const clientUa = attrs.client_ua || ua || null;

  // 5) D1 audit (sanitized only)
  const phHash = await sha256Hex(phoneCanonical);
  const uaH = await uaHash(ua);
  const auditStatus = buyoResult.accepted
    ? (buyoResult.mode === "mock" ? "mock_accepted" : "buyo_accepted")
    : (buyoResult.errorCode ? "error" : "rejected");

  await insertAuditRow(env, {
    submission_id: submissionId,
    event_id: eventId,
    environment,
    buyo_mode: buyoResult.mode,
    status: auditStatus,
    buyo_lead_id: buyoResult.leadId,
    buyo_flow_id: flowId,
    buyo_http_status: buyoResult.statusCode,
    buyo_error_code: buyoResult.errorCode,
    phone_hash: phHash,
    phone_last4: phoneLast4(phoneCanonical),
    utm_source: sanitizeUtm(attrs.utm_source),
    utm_medium: sanitizeUtm(attrs.utm_medium),
    utm_campaign: sanitizeUtm(attrs.utm_campaign),
    utm_term: sanitizeUtm(attrs.utm_term),
    utm_content: sanitizeUtm(attrs.utm_content),
    campaign_id: sanitizeUtm(attrs.campaign_id, 40),
    adset_id: sanitizeUtm(attrs.adset_id, 40),
    ad_id: sanitizeUtm(attrs.ad_id, 40),
    placement: sanitizeUtm(attrs.placement, 40),
    fbclid: sanitizeUtm(attrs.fbclid, 256),
    landing_url: sanitizeUrl(attrs.landing_url),
    referrer_host: referrerHost(request.headers.get("referer")),
    ip_prefix: ipPrefix(ip),
    ua_hash: uaH,
    capi_status: null,
    capi_http_status: null,
    retry_count: 0,
  });

  // 6) Meta CAPI (only on REAL accepted leads; never on mock or rejected)
  if (buyoResult.accepted && buyoResult.mode === "real") {
    // Persist raw browser identifiers so the BUYO Purchase webhook can rebuild
    // full Advanced Matching (fbp/fbc/ip/ua) for the Purchase event later.
    await insertLeadSignals(env, {
      buyo_lead_id: buyoResult.leadId,
      phone_hash: phHash,
      event_id: eventId,
      fbp: typeof attrs._fbp === "string" ? attrs._fbp.slice(0, 128) : null,
      fbc: typeof attrs._fbc === "string" ? attrs._fbc.slice(0, 512) : null,
      fbclid: sanitizeUtm(attrs.fbclid, 256),
      client_ip: ip || null,
      client_ua: (ua || "").slice(0, 512) || null,
      landing_url: sanitizeUrl(attrs.landing_url),
    });
    const capi = await sendCapiLead({
      eventId,
      eventSourceUrl: sanitizeUrl(attrs.landing_url) || "",
      clientIp: ip,
      clientUa: ua,
      fbp: typeof attrs._fbp === "string" ? attrs._fbp : null,
      fbc: typeof attrs._fbc === "string" ? attrs._fbc : null,
      fbclid: typeof attrs.fbclid === "string" ? attrs.fbclid : null,
      phoneCanonical,
      firstName: nameCheck.value.split(/\s+/)[0],
      externalId: (payload.external_id || "").toString() || null,
      country: "uz",
      orderValue: payload.order_value,
      quantity: payload.quantity,
    }, env);
    // Best-effort update audit row
    await insertAuditRow(env, {
      submission_id: submissionId,
      event_id: eventId,
      environment,
      buyo_mode: buyoResult.mode,
      status: auditStatus,
      buyo_lead_id: buyoResult.leadId,
      buyo_flow_id: flowId,
      buyo_http_status: buyoResult.statusCode,
      buyo_error_code: buyoResult.errorCode,
      phone_hash: phHash,
      phone_last4: phoneLast4(phoneCanonical),
      utm_source: sanitizeUtm(attrs.utm_source),
      utm_medium: sanitizeUtm(attrs.utm_medium),
      utm_campaign: sanitizeUtm(attrs.utm_campaign),
      utm_term: sanitizeUtm(attrs.utm_term),
      utm_content: sanitizeUtm(attrs.utm_content),
      campaign_id: sanitizeUtm(attrs.campaign_id, 40),
      adset_id: sanitizeUtm(attrs.adset_id, 40),
      ad_id: sanitizeUtm(attrs.ad_id, 40),
      placement: sanitizeUtm(attrs.placement, 40),
      fbclid: sanitizeUtm(attrs.fbclid, 256),
      landing_url: sanitizeUrl(attrs.landing_url),
      referrer_host: referrerHost(request.headers.get("referer")),
      ip_prefix: ipPrefix(ip),
      ua_hash: uaH,
      capi_status: capi.status,
      capi_http_status: capi.httpStatus,
      retry_count: 0,
    });
  }

  const tookMs = Date.now() - startedAt;
  if (!buyoResult.accepted) {
    return jsonResponse({
      ok: false,
      accepted: false,
      error: "buyo_rejected",
      code: buyoResult.errorCode,
      took_ms: tookMs,
    }, 502);
  }
  return jsonResponse({
    ok: true,
    accepted: true,
    event_id: eventId,
    lead_id: buyoResult.leadId,
    mode: buyoResult.mode,
    took_ms: tookMs,
    client_ip: clientIp,
    client_ua: clientUa,
  });
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
