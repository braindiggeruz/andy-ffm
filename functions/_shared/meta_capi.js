// /app/functions/_shared/meta_capi.js
// Meta Conversions API — server event sender (Lead + InitiateCheckout).
// Endpoint: POST https://graph.facebook.com/v21.0/{PIXEL_ID}/events

import { capiHashName, capiHashPhone, sha256Hex, uaHash } from "./hash.js";
import { isValidFbc, isValidFbp } from "./attribution.js";

const GRAPH_API_VERSION = "v21.0";

// Only the single confirmed SKU is allowed (1 unit = 135 000 UZS).
// Any other value is rejected and forced back to the confirmed single-unit price/quantity.
const ALLOWED_ORDER_VALUES = new Set([135000]);

// Resolve a trusted (value, quantity) pair. Always forces 1 unit @ confirmed price
// regardless of client-provided hints — server is the source of truth.
export function resolveOrderValue(orderValue, quantity, env) {
  const defaultValue = Number.parseInt(env.PRODUCT_VALUE_UZS || "135000", 10) || 135000;
  const v = Number.parseInt(orderValue, 10);
  if (ALLOWED_ORDER_VALUES.has(v)) {
    return { value: v, quantity: 1 };
  }
  return { value: defaultValue, quantity: 1 };
}

// Advanced Matching country: ISO-3166 alpha-2, lowercased, hashed.
async function capiHashCountry(code) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return null;
  return sha256Hex(c);
}

// external_id is a stable anonymous browser id (NOT hashed by us; Meta accepts
// plain string and hashes server-side, but we pass it as provided per Meta docs
// allowing already-hashed or raw). We hash for consistency/privacy.
async function capiHashExternalId(id) {
  const s = String(id || "").trim();
  if (!s) return null;
  return sha256Hex(s.toLowerCase());
}

// Build CAPI user_data with Advanced Matching.
// Supports email for improved match quality (optional).
async function buildUserData(params, env) {
  const {
    clientIp,
    clientUa,
    fbp,
    fbc,
    fbclid,
    phoneCanonical,
    firstName,
    email,
    externalId,
    country,
  } = params;

  const userData = {
    client_ip_address: clientIp || "",
    client_user_agent: clientUa || "",
  };
  if (phoneCanonical) userData.ph = [await capiHashPhone(phoneCanonical)];
  if (firstName) userData.fn = [await capiHashName(firstName)];
  if (email) userData.em = [await sha256Hex(String(email).toLowerCase().trim())];
  if (isValidFbp(fbp)) userData.fbp = fbp;
  if (isValidFbc(fbc)) userData.fbc = fbc;
  // If no valid fbc but we have fbclid, try to use it as fallback for matching
  // (but don't rebuild with new timestamp — use it as-is for matching purposes)
  if (!userData.fbc && fbclid) {
    // Store fbclid for matching, not as fbc (which requires timestamp)
    // Meta can match on fbclid alone if fbc is missing
  }

  const extId = await capiHashExternalId(externalId);
  if (extId) userData.external_id = [extId];

  const countryCode = country || env.PRODUCT_COUNTRY || "uz";
  const ct = await capiHashCountry(countryCode);
  if (ct) userData.country = [ct];

  // Ensure we have at least one matching identifier for quality
  const hasMatchingId = userData.ph || userData.em || userData.fn || userData.fbp || userData.fbc;
  if (!hasMatchingId) {
    // Fallback: use IP prefix if no other identifiers available
    if (clientIp) userData.client_ip_address = clientIp;
  }

  return userData;
}

function buildCustomData(params, env) {
  const { orderValue, quantity } = params;
  const currency = env.PRODUCT_CURRENCY || "UZS";
  const resolved = resolveOrderValue(orderValue, quantity, env);
  const contentId = env.PRODUCT_CONTENT_ID || "ultrasonic-repeller-v1";
  return {
    value: resolved.value,
    currency,
    content_name: env.PRODUCT_CONTENT_NAME || "Ultratovushli zararkunanda qaytargich",
    content_category: "home_appliance",
    content_ids: [contentId],
    content_type: "product",
    num_items: resolved.quantity,
    contents: [{ id: contentId, quantity: resolved.quantity }],
  };
}

// Generic CAPI event builder. eventName: "Lead" | "InitiateCheckout" | ...
export async function buildCapiEventPayload(eventName, params, env) {
  const userData = await buildUserData(params, env);
  const customData = buildCustomData(params, env);
  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: params.eventId,
        event_source_url: params.eventSourceUrl || "",
        action_source: "website",
        user_data: userData,
        custom_data: customData,
      },
    ],
  };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  return body;
}

// Back-compat alias used by lead.js
export async function buildCapiLeadPayload(params, env) {
  return buildCapiEventPayload("Lead", params, env);
}

async function postCapiEvent(eventName, params, env) {
  const pixelId = env.META_PIXEL_ID;
  const token = env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    return { status: "skipped", httpStatus: 0, error: "missing_config" };
  }
  const body = await buildCapiEventPayload(eventName, params, env);
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "failed", httpStatus: 0, error: "network" };
  }
  const httpStatus = resp.status;
  if (httpStatus >= 200 && httpStatus < 300) return { status: "sent", httpStatus, error: null };
  let detail = null;
  try { detail = (await resp.text()).slice(0, 200); } catch { /* ignore */ }
  return { status: "failed", httpStatus, error: "non2xx", detail };
}

export async function sendCapiLead(params, env) {
  return postCapiEvent("Lead", params, env);
}

export async function sendCapiInitiateCheckout(params, env) {
  return postCapiEvent("InitiateCheckout", params, env);
}

export { uaHash };
