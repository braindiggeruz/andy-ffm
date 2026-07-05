// /app/functions/_shared/validate.js
// Server-side input validation for the lead form.

// Accept both Latin and Cyrillic Uzbek names
const LATIN_RE = /^[A-Za-z\u02BB\u02BC\u2018\u2019' \-\u02B9]{2,40}$/;
const CYRILLIC_RE = /^[\u0400-\u04FF' \-]{2,40}$/;
const MIXED_RE = /^[A-Za-z\u0400-\u04FF\u02BB\u02BC\u2018\u2019' \-\u02B9]{2,40}$/;
const URL_RE = /^https?:\/\/[^\s]{4,500}$/i;

export function validateName(raw) {
  if (raw == null) return { ok: false, error: "empty" };
  const v = String(raw).trim();
  if (v.length < 2) return { ok: false, error: "too_short" };
  if (v.length > 40) return { ok: false, error: "too_long" };
  // Accept Latin, Cyrillic, or mixed names
  if (!MIXED_RE.test(v)) return { ok: false, error: "invalid_chars" };
  return { ok: true, value: v };
}

export function sanitizeUtm(raw, maxLen = 120) {
  if (raw == null) return null;
  const s = String(raw).slice(0, maxLen).replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  return s || null;
}

export function sanitizeUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).slice(0, 500).trim();
  return URL_RE.test(s) ? s : null;
}
