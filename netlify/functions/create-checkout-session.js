// Creates a Stripe Checkout Session from the cart contents sent by script.js.
// Runs server-side (Netlify Function) because the Stripe secret key must never
// reach the browser. Set STRIPE_SECRET_KEY in Netlify's Environment Variables —
// never commit it to the repo.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Stripe isn't configured yet — missing STRIPE_SECRET_KEY." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const shippingCost = parseFloat(payload.shippingCost) || 0;
  const shippingLabel = (payload.shippingLabel || "Shipping").toString().slice(0, 250);
  const taxCost = parseFloat(payload.taxCost) || 0;
  const siteUrl = (payload.siteUrl || "").replace(/\/$/, "");

  if (items.length === 0 || !siteUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Your bag is empty." }) };
  }

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("success_url", siteUrl + "/checkout-success.html");
  params.append("cancel_url", siteUrl + "/shop.html");

  let i = 0;
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const cents = Math.round((parseFloat(item.price) || 0) * 100);
    const name = (item.name || "").toString().slice(0, 250);
    if (!name || cents <= 0) return;
    params.append("line_items[" + i + "][quantity]", String(qty));
    params.append("line_items[" + i + "][price_data][currency]", "usd");
    params.append("line_items[" + i + "][price_data][unit_amount]", String(cents));
    params.append("line_items[" + i + "][price_data][product_data][name]", name);
    i++;
  });

  if (shippingCost > 0) {
    params.append("line_items[" + i + "][quantity]", "1");
    params.append("line_items[" + i + "][price_data][currency]", "usd");
    params.append("line_items[" + i + "][price_data][unit_amount]", String(Math.round(shippingCost * 100)));
    params.append("line_items[" + i + "][price_data][product_data][name]", shippingLabel);
    i++;
  }

  if (taxCost > 0) {
    params.append("line_items[" + i + "][quantity]", "1");
    params.append("line_items[" + i + "][price_data][currency]", "usd");
    params.append("line_items[" + i + "][price_data][unit_amount]", String(Math.round(taxCost * 100)));
    params.append("line_items[" + i + "][price_data][product_data][name]", "CA Sales Tax");
    i++;
  }

  if (i === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Nothing to check out." }) };
  }

  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secretKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await stripeRes.json();

    if (!stripeRes.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: (data.error && data.error.message) || "Stripe error." }),
      };
    }

    return { statusCode: 200, body: JSON.stringify({ url: data.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not reach Stripe." }) };
  }
};
