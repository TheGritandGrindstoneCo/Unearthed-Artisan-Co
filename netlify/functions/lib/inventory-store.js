const { getStore } = require("@netlify/blobs");

// The 7 soap scents — the only products with tracked inventory. Matches the
// data-id values used on the soap "Add to Bag" buttons in shop.html.
const SCENT_IDS = [
  "quiet-clay",
  "jade-hollow",
  "violet-dusk",
  "violet-storm",
  "garnet-dawn",
  "indigo-grove",
  "onyx-ember",
];

// New scents default to "in stock" (not sold out) until a real count is set
// via the inventory admin page — avoids an accidental "everything sold out"
// state on first deploy, before anyone has entered real numbers.
const DEFAULT_STOCK = 999;

function inventoryStore() {
  // Automatic environment injection for Netlify Blobs isn't available in
  // this site's functions, so the site ID and an access token are supplied
  // manually. Set NETLIFY_SITE_ID and NETLIFY_API_TOKEN in Netlify's
  // Environment Variables — never commit them to the repo.
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: "soap-inventory", consistency: "strong", siteID, token });
  }
  return getStore({ name: "soap-inventory", consistency: "strong" });
}

async function readInventory() {
  const store = inventoryStore();
  const stock = {};
  await Promise.all(
    SCENT_IDS.map(async (id) => {
      const raw = await store.get(id);
      const n = raw === null ? DEFAULT_STOCK : parseInt(raw, 10);
      stock[id] = Number.isFinite(n) ? Math.max(0, n) : DEFAULT_STOCK;
    })
  );
  return stock;
}

module.exports = { SCENT_IDS, DEFAULT_STOCK, inventoryStore, readInventory };
