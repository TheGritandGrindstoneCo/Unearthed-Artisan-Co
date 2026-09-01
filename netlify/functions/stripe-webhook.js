// Stripe calls this the moment a checkout session completes. Decrements
// tracked product inventory (soap, lotion, lip balm) by the amounts recorded
// in the session's metadata at checkout time. Set STRIPE_WEBHOOK_SECRET in
// Netlify's Environment Variables — get it
// from the Stripe Dashboard when you create the webhook endpoint (Developers
// > Webhooks > Add endpoint, pointed at /.netlify/functions/stripe-webhook,
// listening for the checkout.session.completed event).
const Stripe = require("stripe");
const { SCENT_IDS, inventoryStore } = require("./lib/inventory-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return { statusCode: 500, body: "Webhook isn't configured yet." };
  }

  const stripe = Stripe(secretKey);
  const signature = event.headers["stripe-signature"];

  // Must use the raw, untouched body — not a re-serialized JSON.parse of it —
  // or Stripe's signature check will fail. Netlify sometimes delivers the
  // body base64-encoded (event.isBase64Encoded), which also breaks the
  // signature check unless decoded back to the original bytes first.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    console.error("Stripe webhook signature verification failed:", e && e.message);
    return { statusCode: 400, body: "Signature verification failed." };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    let deductions = {};
    try {
      deductions = JSON.parse((session.metadata && session.metadata.stock_deductions) || "{}");
    } catch (e) {
      deductions = {};
    }

    console.log("Stripe webhook: checkout.session.completed, deductions:", deductions);

    const scentIdSet = new Set(SCENT_IDS);
    const store = inventoryStore();

    for (const id of Object.keys(deductions)) {
      if (!scentIdSet.has(id)) continue;
      const qty = parseInt(deductions[id], 10);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      try {
        const raw = await store.get(id);
        const current = raw === null ? null : parseInt(raw, 10);
        // If no count was ever set for this scent, there's nothing meaningful
        // to decrement from (it's been treated as unlimited) — skip it.
        if (current === null || !Number.isFinite(current)) continue;
        await store.set(id, String(Math.max(0, current - qty)));
      } catch (e) {
        // Best-effort — one scent failing to update shouldn't fail the whole
        // webhook response (Stripe would just retry the whole event).
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
