// /app/functions/api/cfg.js
// GET /api/cfg — landing price data for the browser (no secrets).
// The front-end (loadCfgPrices in app.js) fills the hero price block from this.
//
// price_old / sale are OPTIONAL and only emitted when the owner sets a REAL
// anchor price via env (PRODUCT_OLD_PRICE_UZS / PRODUCT_SALE_PCT). We never
// fabricate a discount — if unset, only the real selling price is shown.

function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export const onRequestGet = async ({ env }) => {
  const priceNew = Number.parseInt(env.PRODUCT_VALUE_UZS || "135000", 10) || 135000;

  const body = {
    price_new: fmtInt(priceNew),
    currency: "so'm",
  };

  // Optional honest anchor price (owner-controlled, never fabricated).
  const oldRaw = Number.parseInt(env.PRODUCT_OLD_PRICE_UZS || "", 10);
  if (Number.isFinite(oldRaw) && oldRaw > priceNew) {
    body.price_old = fmtInt(oldRaw);
    body.sale = Math.round((1 - priceNew / oldRaw) * 100);
  } else {
    const salePct = Number.parseInt(env.PRODUCT_SALE_PCT || "", 10);
    if (Number.isFinite(salePct) && salePct > 0 && salePct < 100) {
      body.sale = salePct;
      body.price_old = fmtInt(Math.round((priceNew / (100 - salePct)) * 100));
    }
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
