const { readInventory } = require("./lib/inventory-store");

// Public, read-only. The shop page fetches this on load to know which soap
// scents are sold out.
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const stock = await readInventory();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ stock }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not read inventory." }) };
  }
};
