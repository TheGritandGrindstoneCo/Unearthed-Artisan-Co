// Creates the Stripe Checkout Session for buying a gift card on
// gift-cards.html. The card itself is created and emailed once Stripe
// confirms payment — see the gift card branch in stripe-webhook.js.
const Stripe = require("stripe");
const UACCatalog = require("../../catalog.js");
const { pacificToday } = require("./lib/gift-card-store");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(s, max) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Shifts a YYYY-MM-DD date by `days`.
function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function bad(message) {
  return { statusCode: 400, body: JSON.stringify({ error: message }) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe isn't configured yet — missing STRIPE_SECRET_KEY." }) };
  }

  let p;
  try {
    p = JSON.parse(event.body || "{}");
  } catch (e) {
    return bad("Invalid request body.");
  }

  const { min, max } = UACCatalog.GIFT_CARD;
  const dollars = Number(p.amount);
  if (!Number.isInteger(dollars) || dollars < min || dollars > max) {
    return bad("Please choose a whole-dollar amount from $" + min + " to $" + max + ".");
  }

  const recipientName = clean(p.recipientName, 60);
  const recipientEmail = clean(p.recipientEmail, 120).toLowerCase();
  const senderName = clean(p.senderName, 60);
  // Line breaks are kept in the message; Stripe metadata values max out at
  // 500 characters.
  const message = String(p.message || "").replace(/\r\n?/g, "\n").trim().slice(0, 300);
  if (!recipientName) return bad("Please enter the recipient's name.");
  if (!EMAIL_RE.test(recipientEmail)) return bad("Please enter a valid email address for the recipient.");
  if (!senderName) return bad("Please enter your name so they know who it's from.");

  const today = pacificToday();
  let deliverOn = p.deliverOn ? String(p.deliverOn) : today;
  // The date picker uses the buyer's own calendar, which can still be
  // "yesterday" in California terms (Hawaii late in the evening) — that
  // just means send it now.
  if (deliverOn < today && deliverOn >= addDays(today, -2)) deliverOn = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliverOn) || deliverOn < today || deliverOn > addDays(today, 366)) {
    return bad("Please choose a delivery date between today and one year from now.");
  }

  const siteUrl = (p.siteUrl || "").replace(/\/$/, "");
  if (!siteUrl) return bad("Missing site address.");

  const stripe = Stripe(secretKey);
  const when = deliverOn === today ? "today" : "on " + deliverOn;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: siteUrl + "/gift-cards.html?purchased=1",
      cancel_url: siteUrl + "/gift-cards.html",
      // Cards only (Apple Pay and Google Pay included) — so payment is
      // confirmed the moment checkout finishes and the card can go out
      // right away, rather than waiting days on a bank transfer.
      payment_method_types: ["card"],
      // Gift cards can't be bought with a promo code, and aren't taxed when
      // sold — tax is charged on what they're spent on.
      allow_promotion_codes: false,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: dollars * 100,
            product_data: {
              name: "Unearthed Artisan Co. Gift Card — $" + dollars,
              description: "Emailed to " + recipientName + " " + when,
            },
          },
        },
      ],
      payment_intent_data: { description: "Gift card for " + recipientName },
      custom_text: {
        submit: { message: "Your gift card will be emailed to " + recipientEmail + " " + when + ", and we'll send you a copy." },
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: {
        // Tells stripe-webhook.js to issue a gift card, and export-orders.js
        // to leave it out of the shipping lists.
        order_type: "gift_card",
        gift_amount: String(dollars * 100),
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        sender_name: senderName,
        gift_message: message,
        deliver_on: deliverOn,
      },
    });
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: (e && e.message) || "Stripe error." }) };
  }
};
