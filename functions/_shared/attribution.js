// /app/functions/_shared/attribution.js
// First-party attribution helpers.

const FBP_RE = /^fb\.\d+\.\d{10,13}\.\d+$/;
const FBC_RE = /^fb\.\d+\.\d{10,13}\..+$/;

export function isValidFbp(v) { return !!v && FBP_RE.test(v); }
export function isValidFbc(v) { return !!v && FBC_RE.test(v); }

export function buildFbcFromFbclid(fbclid, nowMs) {
  if (!fbclid) return null;
  const ts = nowMs || Date.now();
  return `fb.1.${ts}.${fbclid}`;
}

export function ipPrefix(ip) {
  if (!ip) return null;
  const v4 = String(ip).match(/^(\d{1,3})\.(\d{1,3})\./);
  if (v4) return `${v4[1]}.${v4[2]}`;
  const v6 = String(ip).match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})/i);
  if (v6) return `${v6[1]}:${v6[2]}`;
  return null;
}

export function referrerHost(referrer) {
  if (!referrer) return null;
  try { return new URL(referrer).host || null; } catch { return null; }
}
