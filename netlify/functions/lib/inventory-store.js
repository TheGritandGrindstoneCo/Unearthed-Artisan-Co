const { getStore } = require("@netlify/blobs");

// The products with tracked inventory — 7 soap scents, 2 tallow lotions, and
// 3 lip balms. Matches the data-id values used on the "Add to Bag" buttons
// in shop.html.
const SCENT_IDS = [
  "quiet-clay",
  "jade-hollow",
  "violet-dusk",
  "violet-storm",
  "garnet-dawn",
  "indigo-grove",
  "onyx-ember",
  "lavender-tallow-lotion",
  "frankincense-facial-lotion",
  "vanilla-lip-balm",
  "peppermint-lip-balm",
  "guava-lip-balm",
];

// Display names for building customer-facing messages (e.g. stock shortages).
const SCENT_NAMES = {
  "quiet-clay": "Quiet Clay",
  "jade-hollow": "Jade Hollow",
  "violet-dusk": "Violet Dusk",
  "violet-storm": "Violet Storm",
  "garnet-dawn": "Garnet Dawn",
  "indigo-grove": "Indigo Grove",
  "onyx-ember": "Onyx Ember",
  "lavender-tallow-lotion": "Lavender Tallow Body Lotion",
  "frankincense-facial-lotion": "Frankincense Tallow Facial Lotion",
  "vanilla-lip-balm": "Vanilla Tallow Lip Balm",
  "peppermint-lip-balm": "Peppermint Tallow Lip Balm",
  "guava-lip-balm": "Guava Tallow Lip Balm",
};

// New products default to "in stock" (not sold out) until a real count is
// set via the inventory admin page — avoids an accidental "everything sold
// out" state on first deploy, before anyone has entered real numbers.
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

module.exports = { SCENT_IDS, SCENT_NAMES, DEFAULT_STOCK, inventoryStore, readInventory };
