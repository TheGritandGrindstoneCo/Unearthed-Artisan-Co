const { readInventory } = require("./lib/inventory-store");

// Public, read-only. The shop page fetches this on load to know which items
// are sold out. It deliberately returns only the sold-out product ids, not
// stock counts — exact counts are admin-only (update-inventory.js with
// action "read", behind the admin password).
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const stock = await readInventory();
    const soldOut = Object.keys(stock).filter((id) => !(stock[id] > 0));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ soldOut }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not read inventory." }) };
  }
};
