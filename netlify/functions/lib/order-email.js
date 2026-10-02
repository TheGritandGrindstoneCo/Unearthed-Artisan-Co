// Sends a branded thank-you email after a successful checkout, via Gmail
// SMTP using an App Password (not the real Gmail login password). Set
// GMAIL_USER and GMAIL_APP_PASSWORD in Netlify's Environment Variables —
// generate the app password at Google Account > Security > 2-Step
// Verification > App passwords (requires 2-Step Verification to be on).
// Best-effort: called from the webhook's checkout.session.completed
// handler, which already returns 200 regardless, so a failure here never
// causes Stripe to retry the event.
const nodemailer = require("nodemailer");

function formatMoney(cents) {
  return "$" + (cents / 100).toFixed(2);
}

function row(label, amount) {
  return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e0d3;color:#2b2820;font-size:15px;">${label}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e0d3;color:#2b2820;font-size:15px;text-align:right;white-space:nowrap;">${amount}</td>
        </tr>`;
}

// Products are listed at their pre-discount, pre-tax price; any promo code
// discount, shipping, and sales tax (from Stripe Tax) follow as their own
// rows from the session's totals, so the rows add up to the Total.
//
// Orders paid with a gift card carry shipping and tax as line items instead
// (see create-checkout-session.js), and the session's discount is the gift
// card — so those are pulled back out of the item list and shown the same
// way, with the card last.
const GIFT_ORDER_EXTRA_LINES = ["Standard Shipping", "Local Delivery", "Sales Tax"];

function buildHtml({ lineItems, totals, total, paidWithGiftCard }) {
  const products = paidWithGiftCard
    ? lineItems.filter((item) => !GIFT_ORDER_EXTRA_LINES.includes(item.description))
    : lineItems;
  let rows = products
    .map((item) =>
      row(item.description + (item.quantity > 1 ? " &times; " + item.quantity : ""), formatMoney(item.amount_subtotal))
    )
    .join("");
  if (paidWithGiftCard) {
    const ship = lineItems.find((item) => item.description === "Standard Shipping" || item.description === "Local Delivery");
    const tax = lineItems.find((item) => item.description === "Sales Tax");
    rows += row("Shipping", ship ? formatMoney(ship.amount_subtotal) : "Free");
    if (tax) rows += row("Sales Tax", formatMoney(tax.amount_subtotal));
    rows += row("Gift Card", "&minus;" + formatMoney(totals.amount_discount || 0));
  } else {
    if (totals.amount_discount > 0) rows += row("Discount", "&minus;" + formatMoney(totals.amount_discount));
    rows += row("Shipping", totals.amount_shipping > 0 ? formatMoney(totals.amount_shipping) : "Free");
    if (totals.amount_tax > 0) rows += row("Sales Tax", formatMoney(totals.amount_tax));
  }

  return `
  <div style="background:#f6f3e9;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <div style="background:#f6f3e9;padding:32px 24px;text-align:center;">
        <a href="https://unearthedartisanco.com/" style="text-decoration:none;">
          <img src="https://unearthedartisanco.com/assets/logo.png" width="120" height="120" alt="Unearthed Artisan Co." style="display:block;margin:0 auto 16px;width:120px;height:120px;border:0;border-radius:50%;" />
        </a>
        <p style="margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;font-size:12px;color:#5c7346;font-weight:600;">Handcrafted in the USA</p>
        <h1 style="margin:0;font-size:22px;letter-spacing:1px;color:#000000;">UNEARTHED ARTISAN CO.</h1>
      </div>
      <div style="padding:32px 24px;">
        <h2 style="margin:0 0 12px;font-size:20px;color:#000000;">Thank You For Your Order!</h2>
        <p style="margin:0 0 24px;font-style:italic;color:#2b2820;font-size:15px;line-height:1.6;">
          Thank you for letting us be part of your everyday ritual. Every piece is handcrafted with care &mdash; mixed, poured, and packed just for you.
        </p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          ${rows}
          <tr>
            <td style="padding:14px 0 0;font-weight:bold;color:#000000;font-size:15px;">Total</td>
            <td style="padding:14px 0 0;font-weight:bold;color:#000000;font-size:15px;text-align:right;">${formatMoney(total)}</td>
          </tr>
        </table>
        <p style="margin:24px 0 0;color:#2b2820;font-size:14px;line-height:1.6;">
          Your pieces are reserved and will be hand-wrapped in our studio, each one finished with care before it leaves our hands. We'll send your shipping details the moment your order is on its way.
        </p>
        <p style="margin:24px 0 0;color:#2b2820;font-size:14px;line-height:1.6;">
          Questions in the meantime? Just reply to this email &mdash; we're always happy to help.
        </p>
      </div>
      <div style="background:#f6f3e9;padding:20px 24px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#5c7346;">
          <a href="https://unearthedartisanco.com/" style="color:#5c7346;text-decoration:none;">unearthedartisanco.com</a>
          &middot;
          <a href="https://www.instagram.com/unearthedartisanco" style="color:#5c7346;text-decoration:none;">@unearthedartisanco</a>
        </p>
      </div>
    </div>
  </div>`;
}

async function sendOrderConfirmationEmail(stripe, session) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("Order confirmation email skipped: GMAIL_USER/GMAIL_APP_PASSWORD not set.");
    return;
  }

  const toEmail = session.customer_details && session.customer_details.email;
  if (!toEmail) {
    console.error("Order confirmation email skipped: no customer email on session.");
    return;
  }

  const lineItemsResponse = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"Unearthed Artisan Co." <${user}>`,
    to: toEmail,
    subject: "Thank you for your order — Unearthed Artisan Co.",
    html: buildHtml({
      lineItems: lineItemsResponse.data,
      totals: session.total_details || {},
      total: session.amount_total,
      paidWithGiftCard: !!(session.metadata && session.metadata.gift_code),
    }),
  });
}

module.exports = { sendOrderConfirmationEmail };
