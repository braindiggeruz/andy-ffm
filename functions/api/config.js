// /app/functions/api/config.js
// GET /api/config — public configuration the browser bundle needs (no secrets).

export const onRequestGet = async ({ env }) => {
  const body = {
    pixel_id: env.META_PIXEL_ID || "",
    value: Number.parseInt(env.PRODUCT_VALUE_UZS || "135000", 10),
    currency: env.PRODUCT_CURRENCY || "UZS",
    content_name: env.PRODUCT_CONTENT_NAME || "Ultratovushli zararkunanda qaytargich",
    content_id: env.PRODUCT_CONTENT_ID || "ultrasonic-repeller-v1",
    mock_mode: String(env.BUYO_MOCK_MODE || "false").toLowerCase() === "true",
  };
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
