const { SCENT_IDS, inventoryStore, readInventory } = require("./lib/inventory-store");

// Password-protected. Called by inventory.html to set/restock counts, and
// with action "read" to load the current counts once the admin password is
// entered (the public get-inventory only says what's sold out).
// Set INVENTORY_ADMIN_PASSWORD in Netlify's environment variables — never
// commit it to the repo.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const adminPassword = process.env.INVENTORY_ADMIN_PASSWORD;
  if (!adminPassword) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Inventory admin isn't configured yet — missing INVENTORY_ADMIN_PASSWORD." }),
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

  if (payload.action === "read") {
    try {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ stock: await readInventory() }),
      };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Could not read inventory." }) };
    }
  }

  const stock = payload.stock;
  if (!stock || typeof stock !== "object") {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing stock values." }) };
  }

  const store = inventoryStore();
  const updates = [];
  for (const id of SCENT_IDS) {
    if (Object.prototype.hasOwnProperty.call(stock, id)) {
      const n = parseInt(stock[id], 10);
      if (Number.isFinite(n) && n >= 0) {
        updates.push(store.set(id, String(n)));
      }
    }
  }

  try {
    await Promise.all(updates);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("update-inventory failed:", e && e.message, e);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not save inventory: " + ((e && e.message) || "unknown error") }) };
  }
};
