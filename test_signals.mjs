import { buildCapiEventPayload } from "./functions/_shared/meta_capi.js";
import { insertLeadSignals, findLeadSignals } from "./functions/_shared/d1.js";

// --- Fake D1 ---
class FakeDB {
  constructor() { this.rows = []; }
  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async run() {
            if (sql.includes("INSERT INTO lead_signals")) {
              db.rows.push({ id: db.rows.length + 1, buyo_lead_id: args[0], phone_hash: args[1], event_id: args[2], fbp: args[3], fbc: args[4], fbclid: args[5], client_ip: args[6], client_ua: args[7], landing_url: args[8] });
            }
            return {};
          },
          async first() {
            if (sql.includes("buyo_lead_id = ?1")) return db.rows.filter(r => r.buyo_lead_id === args[0]).pop() || null;
            if (sql.includes("phone_hash = ?1")) return db.rows.filter(r => r.phone_hash === args[1] || r.phone_hash === args[0]).pop() || null;
            return null;
          },
        };
      },
      async run() { return {}; },
    };
  }
}

const env = { AUDIT_DB: new FakeDB(), META_PIXEL_ID: "px", META_CAPI_ACCESS_TOKEN: "tok", PRODUCT_VALUE_UZS: "135000" };

// TEST 1: fbc rebuilt from fbclid in shared CAPI builder
const p1 = await buildCapiEventPayload("InitiateCheckout", {
  eventId: "11111111-2222-3333-4444-555555555555",
  clientIp: "1.2.3.4", clientUa: "UA",
  fbp: "fb.1.1720000000000.123456", fbc: null, fbclid: "IwABCDtest",
  phoneCanonical: "998901234567",
}, env);
const ud = p1.data[0].user_data;
console.log("T1 fbc from fbclid:", /^fb\.1\.\d+\.IwABCDtest$/.test(ud.fbc) ? "PASS" : "FAIL " + ud.fbc);
console.log("T1 fbp kept:", ud.fbp === "fb.1.1720000000000.123456" ? "PASS" : "FAIL");

// TEST 2: lead_signals insert + find by lead id and phone hash
await insertLeadSignals(env, { buyo_lead_id: "L123", phone_hash: "PH1", event_id: "e1", fbp: "fb.1.1.2", fbc: "fb.1.1.abc", fbclid: "abc", client_ip: "5.6.7.8", client_ua: "Mozilla", landing_url: "https://socks.savdomix.uz/?fbclid=abc" });
const byLead = await findLeadSignals(env, { leadId: "L123", phoneHash: null });
const byPhone = await findLeadSignals(env, { leadId: "NOPE", phoneHash: "PH1" });
console.log("T2 find by lead_id:", byLead && byLead.client_ip === "5.6.7.8" ? "PASS" : "FAIL");
console.log("T2 find by phone_hash:", byPhone && byPhone.fbp === "fb.1.1.2" ? "PASS" : "FAIL");

// TEST 3: webhook end-to-end with stubbed Meta fetch
const sha = async (s) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
};
const expectedPh = await sha("998901234567");
await insertLeadSignals(env, { buyo_lead_id: "L777", phone_hash: expectedPh, event_id: "e2", fbp: "fb.1.1720000000000.999", fbc: null, fbclid: "IwZXh0test", client_ip: "9.9.9.9", client_ua: "TestUA/1.0", landing_url: "https://socks.savdomix.uz/?utm_source=fb" });

let captured = null;
globalThis.fetch = async (url, opts) => {
  captured = JSON.parse(opts.body);
  return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
};
const { onRequestPost } = await import("./functions/api/buyo-webhook.js");
const req = new Request("https://x/api/buyo-webhook", { method: "POST", body: JSON.stringify({ id: "L777", status: "confirmed", phone: "+998 90 123-45-67", name: "Aziz", order_value: "135000" }) });
const resp = await onRequestPost({ request: req, env });
const out = await resp.json();
const evt = captured && captured.data[0];
console.log("T3 webhook ok:", out.ok === true ? "PASS" : "FAIL " + JSON.stringify(out));
console.log("T3 ph hash canonical:", evt.user_data.ph[0] === expectedPh ? "PASS" : "FAIL");
console.log("T3 fbp recovered from D1:", evt.user_data.fbp === "fb.1.1720000000000.999" ? "PASS" : "FAIL " + evt.user_data.fbp);
console.log("T3 fbc rebuilt from stored fbclid:", /^fb\.1\.\d+\.IwZXh0test$/.test(evt.user_data.fbc || "") ? "PASS" : "FAIL " + evt.user_data.fbc);
console.log("T3 ip/ua recovered:", evt.user_data.client_ip_address === "9.9.9.9" && evt.user_data.client_user_agent === "TestUA/1.0" ? "PASS" : "FAIL");
console.log("T3 value parsed:", evt.custom_data.value === 135000 ? "PASS" : "FAIL " + evt.custom_data.value);
console.log("T3 event_source_url from signals:", evt.event_source_url === "https://socks.savdomix.uz/?utm_source=fb" ? "PASS" : "FAIL " + evt.event_source_url);
console.log("T3 dedup event_id:", evt.event_id === "buyo_purchase_L777" ? "PASS" : "FAIL");

// TEST 4: negative status never fires Purchase
captured = null;
const reqNeg = new Request("https://x/api/buyo-webhook", { method: "POST", body: JSON.stringify({ id: "L888", status: "rejected", phone: "+998901111111" }) });
const respNeg = await onRequestPost({ request: reqNeg, env });
const outNeg = await respNeg.json();
console.log("T4 negative skipped:", outNeg.skipped === true && captured === null ? "PASS" : "FAIL");
