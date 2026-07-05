// /app/functions/_shared/phone.js
// Phone normalization for Uzbek numbers. Canonical form: '998XXXXXXXXX'.
//
// Accepts: '+998901234567', '998 90 123 45 67', '901234567',
//          '8901234567' (leading 8 stripped), '+998 (90) 123-45-67'.
// Returns null for unparseable values.

const UZB_OPERATORS = new Set([
  "33", "50", "55",
  "61", "62", "65", "66", "67", "69",
  "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
  "88",
  "90", "91", "93", "94", "95", "97", "98", "99",
]);

export function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.startsWith("00998")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("8")) digits = digits.slice(1);
  let rest;
  if (digits.startsWith("998")) rest = digits.slice(3);
  else if (digits.length === 9) rest = digits;
  else return null;
  if (rest.length !== 9) return null;
  const op = rest.slice(0, 2);
  if (!UZB_OPERATORS.has(op)) return null;
  return "998" + rest;
}

export function formatPhoneDisplay(canonical) {
  // 998901234567 -> '+998 90 123 45 67'
  if (!canonical || canonical.length !== 12) return canonical || "";
  return "+998 " + canonical.slice(3, 5) + " " + canonical.slice(5, 8) + " " + canonical.slice(8, 10) + " " + canonical.slice(10, 12);
}

export function phoneLast4(canonical) {
  if (!canonical || canonical.length < 4) return null;
  return canonical.slice(-4);
}
