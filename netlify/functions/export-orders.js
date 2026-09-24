// Builds CSVs of completed Stripe orders for inventory.html to download:
// - Standard Shipping orders, formatted for Pirate Ship's "spreadsheet
//   upload" shipping-label import, one row per package with its estimated
//   weight and box dimensions. Pirate Ship has no direct Stripe
//   integration, so this is the bridge: download the CSV here, then upload
//   it at pirateship.com to buy and print labels in a batch. On first
//   upload, Pirate Ship will ask you to map each column to a field (Name,
//   Address Line 1, Weight, etc.) — it remembers that mapping for next time.
// - Local Delivery orders, as a separate list for the delivery run (they
//   don't need labels).
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
const UACCatalog = require("../../catalog.js");

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

  // Standard Shipping orders go in the Pirate Ship CSV, one row per package
  // (weight and box size filled in from catalog.js, so labels don't need
  // them typed by hand). Local Delivery orders don't need labels, so they go
  // in a separate list for the delivery run.
  let shippingCsv = csvRow([
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
    "Package",
    "Weight (oz)",
    "Length (in)",
    "Width (in)",
    "Height (in)",
    "Items",
    "Order Total",
  ]);
  let deliveryCsv = csvRow([
    "Order ID",
    "Order Date",
    "Name",
    "Phone",
    "Email",
    "Address Line 1",
    "Address Line 2",
    "City",
    "ZIP",
    "Items",
    "Order Total",
  ]);
  let shippingOrders = 0;
  let deliveryOrders = 0;

  for (const session of toExport) {
    let itemsSummary = "";
    let lineDescriptions = [];
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      lineDescriptions = lineItems.data.map((item) => item.description);
      itemsSummary = lineItems.data
        // Orders placed before Stripe Tax carried shipping and tax as line
        // items — they aren't products, so leave them out of the list.
        .filter((item) => !NON_PRODUCT_LINES.includes(item.description))
        .map((item) => item.description + (item.quantity > 1 ? " x" + item.quantity : ""))
        .join("; ");
    } catch (e) {
      itemsSummary = "(could not load items)";
    }

    // Depending on Stripe API version, the shipping address lands on
    // session.shipping_details, collected_information.shipping_details, or
    // customer_details — check all three so this keeps working regardless of
    // which one this account uses.
    const details =
      session.shipping_details ||
      (session.collected_information && session.collected_information.shipping_details) ||
      null;
    const shippingName = (details && details.name) || (session.customer_details && session.customer_details.name) || "";
    const address = (details && details.address) || (session.customer_details && session.customer_details.address) || {};
    const email = (session.customer_details && session.customer_details.email) || "";
    const phone = (session.customer_details && session.customer_details.phone) || "";
    const orderDate = new Date(session.created * 1000).toISOString().slice(0, 10);
    const total = "$" + formatMoney(session.amount_total);

    if ((await deliveryMethodOf(stripe, session, lineDescriptions)) === "delivery") {
      deliveryOrders++;
      deliveryCsv += csvRow([
        session.id,
        orderDate,
        shippingName,
        phone,
        email,
        address.line1 || "",
        address.line2 || "",
        address.city || "",
        address.postal_code || "",
        itemsSummary,
        total,
      ]);
      continue;
    }

    shippingOrders++;
    // Blank package columns (weigh it yourself) only if the order's products
    // can't be read back — e.g. an order from before inventory tracking.
    const packages = packagesOf(session);
    const rows = packages.length > 0 ? packages : [null];
    rows.forEach((pkg, i) => {
      const label = !pkg ? "" : pkg.box + (rows.length > 1 ? " (" + (i + 1) + " of " + rows.length + ")" : "");
      shippingCsv += csvRow([
        session.id,
        orderDate,
        shippingName,
        email,
        phone,
        address.line1 || "",
        address.line2 || "",
        address.city || "",
        address.state || "",
        address.postal_code || "",
        address.country || "",
        label,
        // Estimated from catalog.js weights, rounded up to the next 0.1 oz —
        // check it on the scale before buying the label.
        pkg ? (Math.ceil(pkg.oz * 10) / 10).toFixed(1) : "",
        pkg ? pkg.dims[0] : "",
        pkg ? pkg.dims[1] : "",
        pkg ? pkg.dims[2] : "",
        itemsSummary,
        total,
      ]);
    });
  }

  try {
    await markExported(toExport.map((s) => s.id));
  } catch (e) {
    // Best-effort — worst case the same orders show up again next export,
    // which is a minor annoyance, not a failure worth blocking the download.
    console.error("Could not mark orders as exported:", e && e.message);
  }

  const date = new Date().toISOString().slice(0, 10);
  const files = [];
  if (shippingOrders > 0 || deliveryOrders === 0) {
    files.push({ filename: "pirate-ship-labels-" + date + ".csv", csv: shippingCsv, orders: shippingOrders });
  }
  if (deliveryOrders > 0) {
    files.push({ filename: "local-delivery-" + date + ".csv", csv: deliveryCsv, orders: deliveryOrders });
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: files, shippingOrders: shippingOrders, deliveryOrders: deliveryOrders }),
  };
};

const NON_PRODUCT_LINES = ["Standard Shipping", "Local Delivery", "CA Sales Tax"];

// "delivery" or "shipping". Orders placed since the export split record it
// in metadata; for older ones, fall back to how the shipping charge was
// labelled (a line item before Stripe Tax, a shipping rate after).
async function deliveryMethodOf(stripe, session, lineDescriptions) {
  const recorded = session.metadata && session.metadata.delivery_method;
  if (recorded === "delivery" || recorded === "shipping") return recorded;
  if (lineDescriptions.includes("Local Delivery")) return "delivery";
  const rateId = session.shipping_cost && session.shipping_cost.shipping_rate;
  if (rateId) {
    try {
      const rate = await stripe.shippingRates.retrieve(rateId);
      if (rate.display_name === "Local Delivery") return "delivery";
    } catch (e) {
      /* fall through — treat as shipped */
    }
  }
  return "shipping";
}

// The packages an order ships in, rebuilt from the per-product counts
// saved on the session at checkout (stock_deductions — Rituals are already
// expanded into their picks there).
function packagesOf(session) {
  let counts = {};
  try {
    counts = JSON.parse((session.metadata && session.metadata.stock_deductions) || "{}");
  } catch (e) {
    return [];
  }
  const items = Object.keys(counts)
    .map((id) => ({ id: id, qty: parseInt(counts[id], 10) }))
    .filter((item) => item.qty > 0);
  return UACCatalog.packages(items);
}
