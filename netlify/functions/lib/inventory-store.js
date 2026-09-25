const { getStore } = require("@netlify/blobs");

// The products with tracked inventory — 9 soap scents, 4 tallow creams,
// 3 lip balms, and 2 accessories. Matches the data-id values used on the
// "Add to Bag" buttons in shop.html.
const SCENT_IDS = [
  "quiet-clay",
  "jade-hollow",
  "lavender-dawn",
  "lilac-bloom",
  "garnet-dusk",
  "indigo-grove",
  "onyx-ember",
  "golden-harvest",
  "emerald-meadow",
  "lavender-tallow-lotion",
  "frankincense-facial-lotion",
  "unscented-body-cream",
  "unscented-facial-cream",
  "vanilla-lip-balm",
  "peppermint-lip-balm",
  "guava-lip-balm",
  "soap-saver-bag",
  "teak-soap-dish",
];

// Display names for building customer-facing messages (e.g. stock shortages).
const SCENT_NAMES = {
  "quiet-clay": "Quiet Clay",
  "jade-hollow": "Jade Hollow",
  "lavender-dawn": "Lavender Dawn",
  "lilac-bloom": "Lavender Bloom",
  "garnet-dusk": "Garnet Dusk",
  "indigo-grove": "Indigo Grove",
  "onyx-ember": "Onyx Ember",
  "golden-harvest": "Golden Harvest",
  "emerald-meadow": "Emerald Meadow",
  "lavender-tallow-lotion": "Lavender Tallow Body Cream",
  "frankincense-facial-lotion": "Frankincense Tallow Facial Cream",
  "unscented-body-cream": "Unscented Tallow Body Cream",
  "unscented-facial-cream": "Unscented Tallow Facial Cream",
  "vanilla-lip-balm": "Vanilla Tallow Lip Balm",
  "peppermint-lip-balm": "Peppermint Tallow Lip Balm",
  "guava-lip-balm": "Guava Tallow Lip Balm",
  "soap-saver-bag": "Sisal Soap Saver Bag",
  "teak-soap-dish": "Teak Soap Dish",
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

// Atomically reserves (decrements) stock for each id in `deductions`
// ({ id: qty, ... }), using Netlify Blobs' onlyIfMatch conditional write so
// two concurrent checkouts can't both succeed in reserving the same last
// unit — one of them will lose the race, retry against the fresh value, and
// eventually see the real (now-lower) count.
//
// Returns { ok: true, reserved: [{id, qty}, ...] } on success, or
// { ok: false, shortageId, available, reserved } if `shortageId` didn't have
// enough stock (or the write kept losing the race) — `reserved` lists what
// was already reserved before the failure, so the caller can roll it back
// with releaseStock().
//
// An id that has never been explicitly stocked (still at its untracked
// default) is treated as unlimited and skipped — nothing to reserve.
async function reserveStock(deductions) {
  const store = inventoryStore();
  const reserved = [];

  for (const id of Object.keys(deductions)) {
    const qty = parseInt(deductions[id], 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    let done = false;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      const result = await store.getWithMetadata(id, { type: "text" });
      const raw = result ? result.data : null;
      const current = raw === null ? null : parseInt(raw, 10);

      if (current === null || !Number.isFinite(current)) {
        done = true; // untracked — unlimited, nothing to reserve
        break;
      }
      if (current < qty) {
        return { ok: false, shortageId: id, available: current, reserved };
      }

      const setResult = await store.set(id, String(current - qty), { onlyIfMatch: result.etag });
      if (setResult && setResult.modified) {
        reserved.push({ id, qty });
        done = true;
      }
      // else: someone else wrote first — loop and retry against a fresh read
    }

    if (!done) {
      return { ok: false, shortageId: id, available: null, reserved };
    }
  }

  return { ok: true, reserved };
}

// Adds stock back for each { id, qty } in `reserved` — the inverse of
// reserveStock(), used to release a reservation that expired unpaid or that
// needs to be rolled back after a partial failure. Best-effort per id: a
// write that keeps losing the race after 5 attempts is skipped rather than
// failing the whole release, since under/over-restocking one id shouldn't
// block the others.
async function releaseStock(reserved) {
  const store = inventoryStore();

  for (const item of reserved) {
    const qty = parseInt(item.qty, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await store.getWithMetadata(item.id, { type: "text" });
      const raw = result ? result.data : null;
      const current = raw === null ? null : parseInt(raw, 10);
      if (current === null || !Number.isFinite(current)) break; // untracked — nothing to release

      const { modified } = await store.set(item.id, String(current + qty), { onlyIfMatch: result.etag });
      if (modified) break;
    }
  }
}

module.exports = { SCENT_IDS, SCENT_NAMES, DEFAULT_STOCK, inventoryStore, readInventory, reserveStock, releaseStock };
