// Builds a CSV of completed Stripe orders (name, address, phone, items,
// total) formatted for Pirate Ship's "spreadsheet upload" shipping-label
// import — Pirate Ship has no direct Stripe integration, so this is the
// bridge: download the CSV here, then upload it at pirateship.com to buy
// and print labels in a batch. On first upload, Pirate Ship will ask you to
// map each column to a field (Name, Address Line 1, City, etc.) — it
// remembers that mapping for next time.
//
// Password-protected with the same INVENTORY_ADMIN_PASSWORD used by
// inventory.html, since this is another internal-only tool.
//
// By default only returns orders not already included in a previous
// export (see lib/order-export-store.js), so re-running this regularly
// never hands you duplicate rows for orders you've already shipped. Pass
// includeExported: true to re-pull everything in the lookback window
// instead (e.g. to recover a CSV you lost before uploading it).
const Stripe = require("stripe");
const { getExportedIds, markExported } = require("./lib/order-export-store");

const DEFAULT_LOOKBACK_DAYS = 30;

function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvRow(values) {
  return values.map(csvField).join(",") + "\r\n";
}

function formatMoney(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const adminPassword = process.env.INVENTORY_ADMIN_PASSWORD;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!adminPassword || !secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Order export isn't configured yet — missing an admin password or Stripe key." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  if (payload.password !== adminPassword) {
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect password." }) };
  }

  const includeExported = payload.includeExported === true;
  const lookbackDays = Math.max(1, parseInt(payload.days, 10) || DEFAULT_LOOKBACK_DAYS);
  const sinceTimestamp = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  const stripe = Stripe(secretKey);

  let sessions = [];
  try {
    let startingAfter;
    for (let page = 0; page < 20; page++) {
      const result = await stripe.checkout.sessions.list({
        status: "complete",
        created: { gte: sinceTimestamp },
        limit: 100,
        starting_after: startingAfter,
      });
      sessions = sessions.concat(result.data);
      if (!result.has_more || result.data.length === 0) break;
      startingAfter = result.data[result.data.length - 1].id;
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not reach Stripe: " + ((e && e.message) || "unknown error") }) };
  }

  const exportedIds = await getExportedIds();
  const toExport = includeExported ? sessions : sessions.filter((s) => !exportedIds.has(s.id));

  // Oldest first, so a CSV opened in a spreadsheet reads top-to-bottom in
  // the order the orders came in.
  toExport.sort((a, b) => a.created - b.created);

  let csv = csvRow([
    "Order ID",
    "Order Date",
    "Name",
    "Email",
    "Phone",
    "Address Line 1",
    "Address Line 2",
    "City",
    "State",
    "ZIP",
    "Country",
    "Items",
    "Order Total",
  ]);

  for (const session of toExport) {
    let itemsSummary = "";
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      itemsSummary = lineItems.data
        .map((item) => item.description + (item.quantity > 1 ? " x" + item.quantity : ""))
        .join("; ");
    } catch (e) {
      itemsSummary = "(could not load items)";
    }

    // Depending on Stripe API version, the shipping address lands on
    // session.shipping_details or on session.customer_details — check both
    // so this keeps working regardless of which one this account uses.
    const shippingName =
      (session.shipping_details && session.shipping_details.name) ||
      (session.customer_details && session.customer_details.name) ||
      "";
    const address =
      (session.shipping_details && session.shipping_details.address) ||
      (session.customer_details && session.customer_details.address) ||
      {};

    csv += csvRow([
      session.id,
      new Date(session.created * 1000).toISOString().slice(0, 10),
      shippingName,
      (session.customer_details && session.customer_details.email) || "",
      (session.customer_details && session.customer_details.phone) || "",
      address.line1 || "",
      address.line2 || "",
      address.city || "",
      address.state || "",
      address.postal_code || "",
      address.country || "",
      itemsSummary,
      "$" + formatMoney(session.amount_total),
    ]);
  }

  try {
    await markExported(toExport.map((s) => s.id));
  } catch (e) {
    // Best-effort — worst case the same orders show up again next export,
    // which is a minor annoyance, not a failure worth blocking the download.
    console.error("Could not mark orders as exported:", e && e.message);
  }

  const filename = "unearthed-artisan-co-orders-" + new Date().toISOString().slice(0, 10) + ".csv";

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
    },
    body: csv,
  };
};
