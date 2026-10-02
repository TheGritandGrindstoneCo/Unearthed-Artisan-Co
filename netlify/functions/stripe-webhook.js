// Stripe calls this on checkout session events. Inventory is reserved
// (decremented) up front when the session is created — see
// create-checkout-session.js — so a completed session needs no further
// inventory action, only the branded order-confirmation email (see
// lib/order-email.js); expired/failed sessions instead release that
// reservation since they never turned into a sale. Set STRIPE_WEBHOOK_SECRET
// in Netlify's Environment Variables — get it from the Stripe Dashboard when
// you create the webhook endpoint (Developers > Webhooks > Add endpoint,
// pointed at /.netlify/functions/stripe-webhook). Subscribe it to
// checkout.session.completed, checkout.session.expired, and
// checkout.session.async_payment_failed. Also set GMAIL_USER and
// GMAIL_APP_PASSWORD for the confirmation email — see lib/order-email.js.
//
// Gift cards: a completed gift card purchase (metadata.order_type
// "gift_card") issues and emails the card instead. An order paid partly or
// wholly with a gift card (metadata.gift_code) finalizes the amount held on
// the card and records its sales tax; if it expires unpaid, the held amount
// goes back on the card.
const Stripe = require("stripe");
const { releaseStock } = require("./lib/inventory-store");
const { sendOrderConfirmationEmail } = require("./lib/order-email");
const { finalizeHold, releaseHold } = require("./lib/gift-card-store");
const { issueGiftCard } = require("./lib/gift-card-issue");

// Order paid (or fully covered by the card): the held gift card amount is
// spent, and the tax worked out at checkout goes on record in Stripe Tax.
// Both steps are safe to repeat when Stripe retries the event.
async function settleGiftCardOrder(stripe, session) {
  const m = session.metadata;
  await finalizeHold(m.gift_code, m.gift_hold, session.id);
  if (m.tax_calculation) {
    try {
      await stripe.tax.transactions.createFromCalculation({ calculation: m.tax_calculation, reference: session.id });
    } catch (e) {
      // Already recorded on an earlier attempt — that's fine. Anything else
      // is logged so the tax can be checked by hand.
      if (!/reference/i.test((e && e.message) || "")) {
        console.error("Could not record tax for gift card order " + session.id + ":", e && e.message);
      }
    }
  }
  const shippedZip =
    session.collected_information &&
    session.collected_information.shipping_details &&
    session.collected_information.shipping_details.address &&
    session.collected_information.shipping_details.address.postal_code;
  if (shippedZip && m.gift_zip && String(shippedZip).slice(0, 5) !== m.gift_zip) {
    console.error(
      "Gift card order " + session.id + ": tax was calculated for ZIP " + m.gift_zip + " but it ships to " + shippedZip + "."
    );
  }
  if (m.gift_coupon) await stripe.coupons.del(m.gift_coupon).catch(() => {});
}

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

  const eventSession = stripeEvent.data.object;
  const meta = (eventSession && eventSession.metadata) || {};

  if (stripeEvent.type === "checkout.session.completed" && meta.order_type === "gift_card") {
    // Gift card purchases only take cards, so they're always paid by now.
    // Unlike the order email below, a failure here returns 500 so Stripe
    // retries — the card has to reach someone. issueGiftCard picks up where
    // a failed attempt stopped.
    if (eventSession.payment_status === "paid") {
      try {
        await issueGiftCard(eventSession);
      } catch (e) {
        console.error("Gift card issue failed for " + eventSession.id + ":", e && e.message);
        return { statusCode: 500, body: "Gift card issue failed." };
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    if (meta.gift_code) {
      try {
        await settleGiftCardOrder(stripe, eventSession);
      } catch (e) {
        console.error("Gift card settle failed for " + eventSession.id + ":", e && e.message);
        return { statusCode: 500, body: "Gift card settle failed." };
      }
    }

    // Stock for this session was already reserved (decremented) when it was
    // created — nothing left to do here for inventory. This confirms the
    // reservation turned into an actual sale rather than expiring unpaid.
    console.log("Stripe webhook: checkout.session.completed (stock already reserved at checkout).");

    try {
      await sendOrderConfirmationEmail(stripe, stripeEvent.data.object);
    } catch (e) {
      // Best-effort — this function already returns 200 below regardless,
      // so a failure here never causes Stripe to retry the whole event.
      console.error("Order confirmation email failed:", e && e.message);
    }
  } else if (
    stripeEvent.type === "checkout.session.expired" ||
    stripeEvent.type === "checkout.session.async_payment_failed"
  ) {
    const session = stripeEvent.data.object;

    // Before the stock release below, because a failure here asks Stripe to
    // retry the event — releasing the gift card twice is harmless (the hold
    // is gone after the first), but releasing stock twice isn't.
    if (meta.gift_code) {
      try {
        await releaseHold(meta.gift_code, meta.gift_hold);
        if (meta.gift_coupon) await stripe.coupons.del(meta.gift_coupon).catch(() => {});
      } catch (e) {
        console.error("Gift card release failed for " + session.id + ":", e && e.message);
        return { statusCode: 500, body: "Gift card release failed." };
      }
    }

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
