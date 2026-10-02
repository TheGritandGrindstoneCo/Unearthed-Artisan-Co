// Public, read-only: looks up a gift card by its code — for the gift card
// page (gift-card.html) and the Gift Card field in the shopping bag. The
// code itself is the key (60 random bits), so knowing it is what lets
// someone see and spend the card, just like a physical one.
const { normalizeCode, getCard } = require("./lib/gift-card-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const code = normalizeCode((event.queryStringParameters || {}).code);
  const notFound = {
    statusCode: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: "We couldn't find that gift card code. Please check it and try again." }),
  };
  if (!code) return notFound;

  let card;
  try {
    card = await getCard(code);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Could not look up that gift card. Please try again." }) };
  }
  if (!card) return notFound;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      code: card.code,
      amount: card.amount,
      balance: card.balance,
      recipientName: card.recipient.name,
      senderName: card.buyer.name,
      message: card.message,
    }),
  };
};
