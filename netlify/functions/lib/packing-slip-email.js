// Emails the shop a new-order notice that doubles as a printable packing
// slip, after every paid order (and a short notice for each gift card sold).
// Sent through the same Gmail account as the customer emails, to
// ORDER_NOTIFY_EMAIL if set in Netlify, otherwise to GMAIL_USER itself.
//
// Top half: the packing slip that goes in the box — no prices, so it's fine
// for gifts, and the same look as the printed slips in Orders\.
// Below a cut line: the shop copy — address, phone, ship-by date, box, and
// what was paid.
const nodemailer = require("nodemailer");
const UACCatalog = require("../../../catalog.js");

const SITE = "https://unearthedartisanco.com";
const SAGE = "#5c7346";
const INK = "#2b2820";
const MUTED = "#7a766b";
const RULE = "#e2ddcf";
// Not products — on orders paid with a gift card, shipping and tax are line
// items (see create-checkout-session.js).
const EXTRA_LINES = ["Standard Shipping", "Local Delivery", "Sales Tax", "CA Sales Tax"];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents) {
  return "$" + ((cents || 0) / 100).toFixed(2);
}

// "October 2, 2026", in California time.
function pacificDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

// "Saturday, October 10" from YYYY-MM-DD.
function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Product counts saved on the session at checkout ({ slug: qty }), with
// Rituals already broken into their picks.
function countsOf(session) {
  try {
    const counts = JSON.parse((session.metadata && session.metadata.stock_deductions) || "{}");
    return Object.keys(counts)
      .map((id) => ({ id: id, qty: parseInt(counts[id], 10) }))
      .filter((item) => item.qty > 0);
  } catch (e) {
    return [];
  }
}

// The whole order ships together, on its latest item's date.
function shipByIso(counts) {
  let latest = null;
  counts.forEach((item) => {
    const iso = UACCatalog.SHIP_DATES[item.id];
    if (iso && (!latest || iso > latest)) latest = iso;
  });
  return latest;
}

// Rituals list their picks after a colon ("Starter Ritual: Soap - Onyx
// Ember, Cream - ..."), so they're split out to pack one by one.
function itemRows(lineItems) {
  return lineItems
    .filter((li) => !EXTRA_LINES.includes(li.description))
    .map((li) => {
      const match = /^(.*?Ritual[^:]*):\s*(.+)$/.exec(li.description || "");
      const title = match ? match[1] : li.description;
      const picks = match ? match[2].split(/,\s*/).map((p) => p.replace(/\s+-\s+/, ": ")) : [];
      const pickHtml = picks
        .map((p) => `<div style="padding:2px 0 0 14px;font-size:13px;color:${MUTED};">&#8226; ${esc(p)}</div>`)
        .join("");
      return `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid ${RULE};font-size:15px;color:${INK};">${esc(title)}${pickHtml}</td>
          <td style="padding:9px 0;border-bottom:1px solid ${RULE};font-size:15px;color:${INK};text-align:right;vertical-align:top;width:60px;">${li.quantity}</td>
        </tr>`;
    })
    .join("");
}

function label(text) {
  return `<p style="margin:0 0 4px;letter-spacing:2px;text-transform:uppercase;font-size:11px;font-weight:bold;color:${SAGE};">${text}</p>`;
}

function infoRow(name, value) {
  return `
        <tr>
          <td style="padding:4px 12px 4px 0;font-size:13px;color:${MUTED};vertical-align:top;white-space:nowrap;">${name}</td>
          <td style="padding:4px 0;font-size:14px;color:${INK};">${value}</td>
        </tr>`;
}

function buildHtml(session, lineItems) {
  const m = session.metadata || {};
  const isDelivery = m.delivery_method === "delivery";
  const details =
    session.shipping_details ||
    (session.collected_information && session.collected_information.shipping_details) ||
    {};
  const customer = session.customer_details || {};
  const name = details.name || customer.name || "";
  const a = details.address || customer.address || {};
  const addressHtml = [esc(a.line1), esc(a.line2), esc([a.city, a.state].filter(Boolean).join(", ") + " " + (a.postal_code || ""))]
    .filter((s) => s.trim())
    .join("<br />");

  const counts = countsOf(session);
  const shipBy = shipByIso(counts);
  const packages = UACCatalog.packages(counts);
  const boxText = packages
    .map((p) => esc(p.box) + " &middot; about " + (Math.ceil(p.oz * 10) / 10).toFixed(1) + " oz &middot; " + p.dims.join(" &times; ") + " in")
    .join("<br />");

  // What was paid. Orders with a gift card carry shipping and tax as items.
  const totals = session.total_details || {};
  const find = (names) => lineItems.find((li) => names.includes(li.description));
  const shipLine = find(["Standard Shipping", "Local Delivery"]);
  const taxLine = find(["Sales Tax"]);
  const products = lineItems
    .filter((li) => !EXTRA_LINES.includes(li.description))
    .reduce((t, li) => t + li.amount_subtotal, 0);
  const shipping = m.gift_code ? (shipLine ? shipLine.amount_subtotal : 0) : totals.amount_shipping || 0;
  const tax = m.gift_code ? (taxLine ? taxLine.amount_subtotal : 0) : totals.amount_tax || 0;
  let paid = "Items " + money(products) + " &middot; " + (isDelivery ? "Delivery " : "Shipping ") + (shipping ? money(shipping) : "free");
  if (tax) paid += " &middot; Tax " + money(tax);
  if (totals.amount_discount) {
    paid += " &middot; " + (m.gift_code ? "Gift card ending " + esc(m.gift_code.slice(-4)) : "Promo code") + " &minus;" + money(totals.amount_discount);
  }
  paid += "<br /><b>Total charged " + money(session.amount_total) + "</b>";

  const method = isDelivery ? "Local delivery" : "Shipped via USPS";
  const placed = pacificDate(session.created);

  return `
  <div style="font-family:Georgia,'Times New Roman',serif;color:${INK};max-width:620px;margin:0 auto;padding:8px;">
    <div style="text-align:center;">
      <img src="${SITE}/assets/logo.png" width="96" height="96" alt="Unearthed Artisan Co." style="display:block;margin:0 auto 10px;width:96px;height:96px;border:0;border-radius:50%;" />
      <p style="margin:0;font-size:20px;font-weight:bold;letter-spacing:1px;color:#000000;">UNEARTHED ARTISAN CO.</p>
      <p style="margin:2px 0 22px;letter-spacing:2px;text-transform:uppercase;font-size:11px;font-weight:bold;color:${SAGE};">Handcrafted in the USA</p>
    </div>
    ${label("Packing Slip")}
    <p style="margin:0 0 2px;font-size:22px;font-weight:bold;">${esc(name)}</p>
    <p style="margin:0 0 16px;font-size:13px;color:${MUTED};">Placed ${placed} &middot; ${method}</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:0 0 6px;border-bottom:2px solid ${RULE};">${label("Item")}</td>
        <td style="padding:0 0 6px;border-bottom:2px solid ${RULE};text-align:right;">${label("Qty")}</td>
      </tr>
      ${itemRows(lineItems)}
    </table>
    <p style="margin:22px 0 12px;font-style:italic;font-size:14px;line-height:1.6;">Thank you for letting us be part of your everyday ritual. Every piece was mixed, poured, and packed by hand, just for you.</p>
    <p style="margin:0 0 2px;font-size:12px;color:${MUTED};">Questions? We're always happy to help.</p>
    <p style="margin:0;font-size:12px;"><b style="color:${SAGE};">unearthedartisanco.com</b> <span style="color:${MUTED};">&middot;</span> <b style="color:${SAGE};">@unearthedartisanco</b></p>

    <p style="margin:28px 0 18px;padding-top:8px;border-top:2px dashed #b9b4a5;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:${MUTED};letter-spacing:1px;">&#9986; CUT HERE &mdash; SHOP COPY BELOW, NOT FOR THE BOX</p>

    ${label(isDelivery ? "Deliver to" : "Ship to")}
    <p style="margin:0 0 14px;font-size:15px;line-height:1.5;"><b>${esc(name)}</b><br />${addressHtml}</p>
    <table style="border-collapse:collapse;">
      ${shipBy ? infoRow(isDelivery ? "Deliver by" : "Ship by", "<b>" + longDate(shipBy) + "</b>") : ""}
      ${boxText ? infoRow("Pack in", boxText) : ""}
      ${infoRow("Phone", esc(customer.phone || "—"))}
      ${infoRow("Email", esc(customer.email || "—"))}
      ${infoRow("Paid", paid)}
      ${m.gift_code ? infoRow("Gift card", esc(m.gift_code)) : ""}
      ${infoRow("Stripe", `<span style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};">${esc(session.id)}</span>`)}
    </table>
  </div>`;
}

function mailer() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER/GMAIL_APP_PASSWORD not set.");
  return { user, to: process.env.ORDER_NOTIFY_EMAIL || user, transport: nodemailer.createTransport({ service: "gmail", auth: { user, pass } }) };
}

async function sendPackingSlipEmail(stripe, session) {
  const { user, to, transport } = mailer();
  const lineItems = (await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 })).data;
  const details =
    session.shipping_details ||
    (session.collected_information && session.collected_information.shipping_details) ||
    {};
  const name = String(details.name || (session.customer_details && session.customer_details.name) || "Customer").replace(/[\r\n]+/g, " ");
  const method = session.metadata && session.metadata.delivery_method === "delivery" ? "Local Delivery" : "Ship";
  const units = lineItems.filter((li) => !EXTRA_LINES.includes(li.description)).reduce((t, li) => t + li.quantity, 0);
  await transport.sendMail({
    from: `"Unearthed Artisan Co. Orders" <${user}>`,
    to: to,
    replyTo: (session.customer_details && session.customer_details.email) || undefined,
    subject: "New order: " + name + " · " + method + " · " + units + (units === 1 ? " item" : " items") + " · " + money(session.amount_total),
    html: buildHtml(session, lineItems),
  });
}

// Gift cards are emailed, so there's nothing to pack — just a heads-up.
async function sendGiftCardSoldEmail(card) {
  const { user, to, transport } = mailer();
  const when = card.deliveredAt ? "emailed today" : "emails the morning of " + longDate(card.deliverOn);
  await transport.sendMail({
    from: `"Unearthed Artisan Co. Orders" <${user}>`,
    to: to,
    replyTo: card.buyer.email || undefined,
    subject: "Gift card sold: " + money(card.amount) + " for " + String(card.recipient.name).replace(/[\r\n]+/g, " ") + " (" + when + ")",
    html: `
  <div style="font-family:Georgia,'Times New Roman',serif;color:${INK};max-width:620px;margin:0 auto;padding:8px;">
    ${label("Gift card sold")}
    <p style="margin:0 0 14px;font-size:22px;font-weight:bold;">${money(card.amount)} for ${esc(card.recipient.name)}</p>
    <table style="border-collapse:collapse;">
      ${infoRow("From", esc(card.buyer.name) + " (" + esc(card.buyer.email) + ")")}
      ${infoRow("To", esc(card.recipient.name) + " (" + esc(card.recipient.email) + ")")}
      ${infoRow("Delivery", card.deliveredAt ? "Emailed to them today" : "Emails the morning of " + longDate(card.deliverOn))}
      ${infoRow("Code", esc(card.code))}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Nothing to pack or ship. Every card and its balance is on your inventory page under Gift Cards.</p>
  </div>`,
  });
}

module.exports = { sendPackingSlipEmail, sendGiftCardSoldEmail };
