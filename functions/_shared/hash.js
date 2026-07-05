// /app/functions/_shared/hash.js
// Web Crypto SHA-256 helpers (works in Cloudflare Workers runtime).

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return toHex(buf);
}

// Meta CAPI hashing rules:
//   ph: digits only, no '+', no leading 00
//   fn/ln/em: trim + lowercase
export async function capiHashPhone(canonical) {
  const digits = String(canonical).replace(/\D+/g, "");
  return sha256Hex(digits);
}

export async function capiHashName(value) {
  return sha256Hex(String(value).trim().toLowerCase());
}

export async function uaHash(ua) {
  return sha256Hex(String(ua || ""));
}
