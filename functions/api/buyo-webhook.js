/**
 * BUYO Webhook Handler (Cloudflare Pages Functions)
 * Receives lead events from BUYO and sends PURCHASE events to Meta CAPI
 * 
 * POST /api/buyo-webhook
 * Triggered by BUYO postback when lead status changes
 * Converts BUYO lead data → Meta CAPI Purchase event
 */

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await request.json();
    
    // Log incoming webhook
    console.log("[BUYO Webhook] Received:", JSON.stringify(payload, null, 2));

    // Validate required fields
    if (!payload || !payload.lead_id) {
      console.warn("[BUYO Webhook] Missing lead_id");
      return new Response(JSON.stringify({ ok: false, error: "Missing lead_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract BUYO lead data
    const {
      lead_id,
      status,
      phone,
      name,
      email,
      order_value,
      created_at,
      attrs = {},
    } = payload;

    // Only process "created" status (when lead is first created in BUYO)
    // Later we can add "accepted" status for confirmed purchases
    if (status !== "created" && status !== "accepted") {
      console.log(`[BUYO Webhook] Skipping status: ${status}`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: `status=${status}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Send to Meta CAPI
    const capiResult = await sendToMetaCAPI({
      lead_id,
      phone,
      name,
      email,
      order_value,
      created_at,
      attrs,
      env,
    });

    if (!capiResult.ok) {
      console.error("[BUYO Webhook] Meta CAPI failed:", capiResult.error);
      return new Response(JSON.stringify({ ok: false, error: capiResult.error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[BUYO Webhook] Success:", capiResult);
    return new Response(JSON.stringify({ ok: true, capi_event_id: capiResult.event_id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[BUYO Webhook] Error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
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

  // Hash phone and email for Advanced Matching
  const phoneHash = phone ? await sha256Hex(normalizePhone(phone)) : null;
  const emailHash = email ? await sha256Hex(String(email).toLowerCase().trim()) : null;

  // Build user_data for Advanced Matching
  const userData = {};

  // Required: hashed PII
  if (phoneHash) userData.ph = [phoneHash];
  if (emailHash) userData.em = [emailHash];
  if (name) userData.fn = [await sha256Hex(String(name).toLowerCase().trim().split(/\s+/)[0])];

  // Browser identifiers (NOT hashed)
  if (attrs._fbp) userData.fbp = attrs._fbp;  // Facebook Pixel ID
  if (attrs._fbc) userData.fbc = attrs._fbc;  // Facebook Click ID

  // Client info (raw, NOT hashed)
  if (attrs.client_ip) userData.client_ip_address = attrs.client_ip;
  if (attrs.client_ua) userData.client_user_agent = attrs.client_ua;  // Raw User-Agent

  // Optional: additional hashed PII for better matching
  if (attrs.ln) userData.ln = [await sha256Hex(String(attrs.ln).toLowerCase().trim())];  // Last name
  if (attrs.ct) userData.ct = [await sha256Hex(String(attrs.ct).toLowerCase().trim())];  // City
  if (attrs.st) userData.st = [await sha256Hex(String(attrs.st).toLowerCase().trim())];  // State
  if (attrs.zp) userData.zp = [await sha256Hex(String(attrs.zp).toLowerCase().trim())];  // Zip code
  if (attrs.country) userData.country = [await sha256Hex(String(attrs.country).toLowerCase().trim())];
  if (attrs.dob) userData.db = [await sha256Hex(String(attrs.dob).replace(/\D/g, ''))];  // DOB YYYYMMDD
  if (attrs.gender) userData.ge = [await sha256Hex(String(attrs.gender).toLowerCase().charAt(0))];

  // Build custom_data
  const customData = {
    value: order_value || 135000,
    currency: "UZS",
  };

  // Build CAPI event
  const eventTime = Math.floor(new Date(created_at || Date.now()).getTime() / 1000);
  const eventId = `buyo_${lead_id}_${Math.random().toString(36).slice(2, 9)}`;

  const capiPayload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
        external_id: lead_id,
        event_source_url: attrs.landing_url || "https://socks.savdomix.uz",
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
      return { ok: false, error: result.error?.message || "Unknown error" };
    }

    console.log("[Meta CAPI] Success:", result);
    return { ok: true, event_id: eventId, capi_response: result };
  } catch (err) {
    console.error("[Meta CAPI] Fetch error:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Normalize phone to 9 digits (Uzbekistan format)
 */
function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D+/g, "");
  if (d.startsWith("00998")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("8")) d = d.slice(1);
  if (d.startsWith("998")) d = d.slice(3);
  return d.slice(0, 9);
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
