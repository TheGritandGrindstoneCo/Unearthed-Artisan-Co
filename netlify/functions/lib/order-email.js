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
function buildHtml({ lineItems, totals, total }) {
  let rows = lineItems
    .map((item) =>
      row(item.description + (item.quantity > 1 ? " &times; " + item.quantity : ""), formatMoney(item.amount_subtotal))
    )
    .join("");
  if (totals.amount_discount > 0) rows += row("Discount", "&minus;" + formatMoney(totals.amount_discount));
  rows += row("Shipping", totals.amount_shipping > 0 ? formatMoney(totals.amount_shipping) : "Free");
  if (totals.amount_tax > 0) rows += row("Sales Tax", formatMoney(totals.amount_tax));

  return `
  <div style="background:#f6f3e9;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <div style="background:#f6f3e9;padding:32px 24px;text-align:center;">
        <p style="margin:0 0 4px;letter-spacing:2px;text-transform:uppercase;font-size:12px;color:#5c7346;font-weight:600;">Handcrafted in the USA</p>
        <h1 style="margin:0;font-size:22px;color:#000000;">Unearthed Artisan Co.</h1>
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
          Your order is being lovingly prepared. We'll follow up separately with shipping and delivery details.
        </p>
        <p style="margin:24px 0 0;color:#2b2820;font-size:14px;line-height:1.6;">
          Questions in the meantime? Just reply to this email &mdash; we're always happy to help.
        </p>
      </div>
      <div style="background:#f6f3e9;padding:20px 24px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#5c7346;">unearthedartisanco.com &middot; @unearthedartisanco</p>
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
    }),
  });
}

module.exports = { sendOrderConfirmationEmail };
