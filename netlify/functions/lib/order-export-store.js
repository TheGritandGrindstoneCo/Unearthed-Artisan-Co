const { getStore } = require("@netlify/blobs");

// Tracks which completed Stripe Checkout Session IDs have already been
// included in a Pirate Ship shipping-label CSV export (see
// export-orders.js), so the default export only ever returns new orders
// instead of re-including ones already shipped. Stored as a single JSON
// blob (a plain array of session ids) since order volume for a small
// handmade-batch business is low enough that this never needs sharding.
const KEY = "exported-session-ids";

function exportStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: "order-exports", consistency: "strong", siteID, token });
  }
  return getStore({ name: "order-exports", consistency: "strong" });
}

async function getExportedIds() {
  const store = exportStore();
  const raw = await store.get(KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

// Adds `ids` (an array of session ids) to the exported set and saves it.
async function markExported(ids) {
  if (!ids || ids.length === 0) return;
  const store = exportStore();
  const existing = await getExportedIds();
  ids.forEach((id) => existing.add(id));
  await store.set(KEY, JSON.stringify(Array.from(existing)));
}

module.exports = { getExportedIds, markExported };
