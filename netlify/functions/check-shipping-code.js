// Public, read-only: checks a code from the bag's Shipping Code field, so the
// Order Summary can show free shipping before checkout. Checkout checks the
// code again itself (create-checkout-session.js), so this only drives the
// display — it can't make an order free on its own.
const { normalizeShippingCode, isFreeShippingCode } = require("./lib/shipping-code");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const code = normalizeShippingCode((event.queryStringParameters || {}).code);
  if (!isFreeShippingCode(code)) {
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "That shipping code isn't valid. Please check it and try again." }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ code: code }),
  };
};
