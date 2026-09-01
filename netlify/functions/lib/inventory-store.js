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
