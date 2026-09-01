// Creates a Stripe Checkout Session from the cart contents sent by script.js.
// Runs server-side (Netlify Function) because the Stripe secret key must never
// reach the browser. Set STRIPE_SECRET_KEY in Netlify's Environment Variables —
// never commit it to the repo.
const Stripe = require("stripe");
const { SCENT_IDS, SCENT_NAMES, readInventory } = require("./lib/inventory-store");

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

  // Sum up how many of each tracked product this order would use — from a
  // single item (item.id is the product slug) and from bundles/gift sets
  // (item.scents lists each product chosen — e.g. a gift set's soap scent,
  // lotion, and lip balm picks), so these pull from the same stock pool as
  // buying that item individually.
  const scentIdSet = new Set(SCENT_IDS);
  const deductions = {};
  const addDeduction = (id, qty) => {
    if (!scentIdSet.has(id)) return;
    deductions[id] = (deductions[id] || 0) + qty;
  };
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    if (Array.isArray(item.scents) && item.scents.length > 0) {
      item.scents.forEach((scentId) => addDeduction(scentId, 1));
    } else if (typeof item.id === "string") {
      addDeduction(item.id, qty);
    }
  });

  if (Object.keys(deductions).length > 0) {
    try {
      const currentStock = await readInventory();
      const shortages = Object.keys(deductions).filter((id) => deductions[id] > (currentStock[id] || 0));
      if (shortages.length > 0) {
        const details = shortages
          .map((id) => {
            const available = currentStock[id] || 0;
            const name = SCENT_NAMES[id] || id;
            return available > 0
              ? name + " (only " + available + " left, " + deductions[id] + " in your bag)"
              : name + " (sold out)";
          })
          .join(", ");
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: "Sorry, not enough in stock: " + details + ". Please update your bag and try again.",
            shortages: shortages,
          }),
        };
      }
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Could not check inventory. Please try again." }) };
    }
  }

  const stripe = Stripe(secretKey);

  const line_items = [];
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const cents = Math.round((parseFloat(item.price) || 0) * 100);
    const name = (item.name || "").toString().slice(0, 250);
    if (!name || cents <= 0) return;
    line_items.push({
      quantity: qty,
      price_data: { currency: "usd", unit_amount: cents, product_data: { name: name } },
    });
  });

  if (shippingCost > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: Math.round(shippingCost * 100), product_data: { name: shippingLabel } },
    });
  }

  if (taxCost > 0) {
    line_items.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: Math.round(taxCost * 100), product_data: { name: "CA Sales Tax" } },
    });
  }

  if (line_items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Nothing to check out." }) };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: siteUrl + "/checkout-success.html",
      cancel_url: siteUrl + "/shipping.html",
      phone_number_collection: { enabled: true },
      // Local Pickup was removed as an option; Local Delivery and Standard
      // Shipping both need a mailing address.
      shipping_address_collection: { allowed_countries: ["US"] },
      line_items: line_items,
      metadata: {
        stock_deductions: JSON.stringify(deductions),
      },
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: (e && e.message) || "Stripe error." }) };
  }
};
