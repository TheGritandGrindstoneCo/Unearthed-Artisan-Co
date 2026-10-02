// Gift card emails, sent through the same Gmail account as the order
// confirmation (GMAIL_USER / GMAIL_APP_PASSWORD — see order-email.js):
// - the gift itself, to the recipient, on the delivery date
// - a receipt to the buyer right after purchase, with the code and a link to
//   the gift card page (gift-card.html), which they can text to anyone
const nodemailer = require("nodemailer");

const SITE = "https://unearthedartisanco.com";

function money(cents) {
  return "$" + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

// Names and the message come from the buyer, so they're escaped before going
// into the HTML.
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// For subject lines — no line breaks.
function oneLine(s) {
  return String(s || "").replace(/[\r\n]+/g, " ").trim();
}

function cardUrl(code) {
  return SITE + "/gift-card.html?code=" + encodeURIComponent(code);
}

// "Thursday, December 25"
function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function frame(inner) {
  return `
  <div style="background:#f6f3e9;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <div style="background:#f6f3e9;padding:32px 24px;text-align:center;">
        <a href="${SITE}/" style="text-decoration:none;">
          <img src="${SITE}/assets/logo.png" width="120" height="120" alt="Unearthed Artisan Co." style="display:block;margin:0 auto 16px;width:120px;height:120px;border:0;border-radius:50%;" />
        </a>
        <p style="margin:0 0 6px;letter-spacing:2px;text-transform:uppercase;font-size:12px;color:#5c7346;font-weight:600;">Handcrafted in the USA</p>
        <h1 style="margin:0;font-size:22px;letter-spacing:1px;color:#000000;">UNEARTHED ARTISAN CO.</h1>
      </div>
      <div style="padding:32px 24px;">${inner}</div>
      <div style="background:#f6f3e9;padding:20px 24px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#5c7346;">
          <a href="${SITE}/" style="color:#5c7346;text-decoration:none;">unearthedartisanco.com</a>
          &middot;
          <a href="https://www.instagram.com/unearthedartisanco" style="color:#5c7346;text-decoration:none;">@unearthedartisanco</a>
        </p>
      </div>
    </div>
  </div>`;
}

function codeBox(card) {
  return `
        <div style="margin:24px 0;padding:24px;border:1px solid #d9d4c5;border-radius:8px;background:#f6f3e9;text-align:center;">
          <p style="margin:0 0 4px;letter-spacing:2px;text-transform:uppercase;font-size:12px;color:#5c7346;font-weight:600;">Gift Card</p>
          <p style="margin:0 0 14px;font-size:40px;color:#000000;">${money(card.amount)}</p>
          <p style="margin:0 0 4px;font-size:12px;color:#5c7346;letter-spacing:1px;text-transform:uppercase;">Your code</p>
          <p style="margin:0;font-family:'Courier New',monospace;font-size:20px;font-weight:bold;letter-spacing:2px;color:#2b2820;">${esc(card.code)}</p>
        </div>`;
}

function button(href, label) {
  return `
        <p style="margin:24px 0 0;text-align:center;">
          <a href="${href}" style="display:inline-block;background:#5c7346;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;">${label}</a>
        </p>`;
}

const HOW_TO_USE = `
        <p style="margin:24px 0 0;color:#2b2820;font-size:14px;line-height:1.6;">
          To use it, add your favorites to your shopping bag at unearthedartisanco.com and enter
          the code under <b>Gift Card</b> in the Order Summary. It can pay for soap, tallow cream,
          lip balm, shipping and tax, and any balance left over stays on the card for next time.
          It never expires.
        </p>`;

function recipientHtml(card) {
  const from = card.buyer.name ? esc(card.buyer.name) : "Someone special";
  const message = card.message
    ? `<p style="margin:0 0 8px;font-style:italic;color:#2b2820;font-size:16px;line-height:1.6;white-space:pre-line;">&ldquo;${esc(card.message)}&rdquo;</p>
        <p style="margin:0;color:#5c7346;font-size:14px;">&mdash; ${from}</p>`
    : `<p style="margin:0;color:#2b2820;font-size:15px;line-height:1.6;">${from} sent you a gift card for handcrafted soap, tallow cream and lip balm.</p>`;
  return frame(`
        <h2 style="margin:0 0 16px;font-size:20px;color:#000000;">${card.recipient.name ? esc(card.recipient.name) + ", a" : "A"} gift for you</h2>
        ${message}
        ${codeBox(card)}
        ${HOW_TO_USE}
        ${button(SITE + "/shop.html", "Shop the Collection")}
        <p style="margin:16px 0 0;text-align:center;font-size:13px;">
          <a href="${cardUrl(card.code)}" style="color:#5c7346;">View your gift card &amp; balance</a>
        </p>`);
}

function buyerHtml(card, delivered) {
  const to = card.recipient.name ? esc(card.recipient.name) : esc(card.recipient.email);
  const when = delivered
    ? `We've emailed it to ${to} at ${esc(card.recipient.email)}.`
    : `We'll email it to ${to} at ${esc(card.recipient.email)} on the morning of ${longDate(card.deliverOn)}.`;
  return frame(`
        <h2 style="margin:0 0 12px;font-size:20px;color:#000000;">Thank you for your gift!</h2>
        <p style="margin:0;color:#2b2820;font-size:15px;line-height:1.6;">Your ${money(card.amount)} gift card is ready. ${when}</p>
        ${codeBox(card)}
        <p style="margin:0;color:#2b2820;font-size:14px;line-height:1.6;">
          <b>Want to text it or give it in person?</b> Open the gift card page below on your phone and
          tap <b>Text it</b> to send it in a message, or print it to tuck into a card.
          Anyone with the code can use the card, so share it only with your recipient.
        </p>
        ${button(cardUrl(card.code), "View &amp; Share the Gift Card")}
        <p style="margin:24px 0 0;color:#2b2820;font-size:14px;line-height:1.6;">
          Questions? Just reply to this email &mdash; we're always happy to help.
        </p>`);
}

function transporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER/GMAIL_APP_PASSWORD not set.");
  return { user, mailer: nodemailer.createTransport({ service: "gmail", auth: { user, pass } }) };
}

async function sendRecipientEmail(card) {
  const { user, mailer } = transporter();
  const from = oneLine(card.buyer.name);
  await mailer.sendMail({
    from: `"Unearthed Artisan Co." <${user}>`,
    to: card.recipient.email,
    subject: (from ? from + " sent you" : "You've received") + " an Unearthed Artisan Co. gift card",
    html: recipientHtml(card),
  });
}

async function sendBuyerReceipt(card, delivered) {
  const { user, mailer } = transporter();
  await mailer.sendMail({
    from: `"Unearthed Artisan Co." <${user}>`,
    to: card.buyer.email,
    subject: "Your " + money(card.amount) + " gift card — Unearthed Artisan Co.",
    html: buyerHtml(card, delivered),
  });
}

module.exports = { sendRecipientEmail, sendBuyerReceipt };
