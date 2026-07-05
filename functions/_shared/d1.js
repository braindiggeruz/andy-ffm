// /app/functions/_shared/d1.js
// D1 audit logger — stores SANITIZED records only (no raw PII, no tokens).

import { ipPrefix, referrerHost } from "./attribution.js";
import { phoneLast4 } from "./phone.js";
import { uaHash } from "./meta_capi.js";

export async function insertAuditRow(env, row) {
  if (!env.AUDIT_DB || !env.AUDIT_DB.prepare) return { ok: false, reason: "no_db_binding" };
  try {
    const stmt = env.AUDIT_DB.prepare(`
      INSERT INTO leads_audit (
        submission_id, event_id, environment, buyo_mode, status,
        buyo_lead_id, buyo_flow_id, buyo_http_status, buyo_error_code,
        phone_hash, phone_last4,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        campaign_id, adset_id, ad_id, placement,
        fbclid, landing_url, referrer_host, ip_prefix, ua_hash,
        capi_status, capi_http_status, retry_count
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5,
        ?6, ?7, ?8, ?9,
        ?10, ?11,
        ?12, ?13, ?14, ?15, ?16,
        ?17, ?18, ?19, ?20,
        ?21, ?22, ?23, ?24, ?25,
        ?26, ?27, ?28
      )
      ON CONFLICT(submission_id) DO UPDATE SET
        retry_count = retry_count + 1,
        status = excluded.status,
        buyo_lead_id = excluded.buyo_lead_id,
        buyo_http_status = excluded.buyo_http_status,
        buyo_error_code = excluded.buyo_error_code,
        capi_status = excluded.capi_status,
        capi_http_status = excluded.capi_http_status,
        updated_at = datetime('now')
    `);
    await stmt.bind(
      row.submission_id, row.event_id, row.environment, row.buyo_mode, row.status,
      row.buyo_lead_id || null, row.buyo_flow_id || null, row.buyo_http_status || null, row.buyo_error_code || null,
      row.phone_hash, row.phone_last4 || null,
      row.utm_source || null, row.utm_medium || null, row.utm_campaign || null, row.utm_term || null, row.utm_content || null,
      row.campaign_id || null, row.adset_id || null, row.ad_id || null, row.placement || null,
      row.fbclid || null, row.landing_url || null, row.referrer_host || null, row.ip_prefix || null, row.ua_hash || null,
      row.capi_status || null, row.capi_http_status || null, row.retry_count || 0,
    ).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "d1_error", error: String(e).slice(0, 200) };
  }
}

export async function alreadySubmitted(env, submissionId) {
  if (!env.AUDIT_DB || !env.AUDIT_DB.prepare) return null;
  try {
    const r = await env.AUDIT_DB.prepare(
      "SELECT submission_id, status, buyo_lead_id, event_id FROM leads_audit WHERE submission_id = ?1"
    ).bind(submissionId).first();
    return r || null;
  } catch { return null; }
}

export { ipPrefix, referrerHost, phoneLast4, uaHash };
