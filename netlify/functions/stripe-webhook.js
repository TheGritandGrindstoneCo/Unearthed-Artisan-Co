// Stripe calls this on checkout session events. Inventory is reserved
// (decremented) up front when the session is created — see
// create-checkout-session.js — so a completed session needs no further
// inventory action; this instead releases that reservation if the session
// expires or fails without ever being paid. Set STRIPE_WEBHOOK_SECRET in
// Netlify's Environment Variables — get it from the Stripe Dashboard when
// you create the webhook endpoint (Developers > Webhooks > Add endpoint,
// pointed at /.netlify/functions/stripe-webhook). Subscribe it to
// checkout.session.completed, checkout.session.expired, and
// checkout.session.async_payment_failed.
const Stripe = require("stripe");
const { releaseStock } = require("./lib/inventory-store");

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
    // Stock for this session was already reserved (decremented) when it was
    // created — nothing left to do here. This confirms the reservation
    // turned into an actual sale rather than expiring unpaid.
    console.log("Stripe webhook: checkout.session.completed (stock already reserved at checkout).");
  } else if (
    stripeEvent.type === "checkout.session.expired" ||
    stripeEvent.type === "checkout.session.async_payment_failed"
  ) {
    const session = stripeEvent.data.object;
    let deductions = {};
    try {
      deductions = JSON.parse((session.metadata && session.metadata.stock_deductions) || "{}");
    } catch (e) {
      deductions = {};
    }

    const reserved = Object.keys(deductions)
      .map((id) => ({ id, qty: parseInt(deductions[id], 10) }))
      .filter((item) => Number.isFinite(item.qty) && item.qty > 0);

    console.log("Stripe webhook:", stripeEvent.type, "- releasing reserved stock:", reserved);

    try {
      await releaseStock(reserved);
    } catch (e) {
      // Best-effort — Stripe will retry the whole event on a non-2xx
      // response if this ever throws, which is the desired fallback.
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
