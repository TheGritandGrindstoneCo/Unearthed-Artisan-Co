// Password-protected (same INVENTORY_ADMIN_PASSWORD as inventory.html).
// Powers the Gift Cards section of inventory.html:
//   action "list"    every card, newest first
//   action "adjust"  add to or take from a balance — e.g. putting money back
//                    on a card after refunding an order it paid for
//   action "send"    email the card to its recipient now (resend, or send
//                    early), or the receipt to the buyer again
const { normalizeCode, getCard, updateCard, listCards } = require("./lib/gift-card-store");
const { deliverGiftCard } = require("./lib/gift-card-issue");
const { sendBuyerReceipt } = require("./lib/gift-card-email");

function reply(statusCode, data) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const adminPassword = process.env.INVENTORY_ADMIN_PASSWORD;
  if (!adminPassword) {
    return reply(500, { error: "Gift card admin isn't configured yet — missing INVENTORY_ADMIN_PASSWORD." });
  }

  let p;
  try {
    p = JSON.parse(event.body || "{}");
  } catch (e) {
    return reply(400, { error: "Invalid request body." });
  }
  if (p.password !== adminPassword) {
    return reply(401, { error: "Incorrect password." });
  }

  try {
    if (p.action === "list") {
      const cards = await listCards();
      cards.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return reply(200, { cards: cards });
    }

    const code = normalizeCode(p.code);
    if (!code || !(await getCard(code))) return reply(404, { error: "No gift card with that code." });

    if (p.action === "adjust") {
      const cents = Math.round(Number(p.amount) * 100);
      if (!Number.isFinite(cents) || cents === 0) return reply(400, { error: "Enter an amount, like 12.50 or -5." });
      const note = String(p.note || "").trim().slice(0, 200);
      const card = await updateCard(code, (c) => {
        if (c.balance + cents < 0) return false;
        c.balance += cents;
        c.history = c.history || [];
        c.history.push({ at: new Date().toISOString(), type: "adjust", amount: cents, note: note });
      });
      if (card === false) return reply(400, { error: "That would take the balance below $0." });
      return reply(200, { card: card });
    }

    if (p.action === "send") {
      if (p.to === "buyer") {
        const card = await getCard(code);
        await sendBuyerReceipt(card, !!card.deliveredAt);
        return reply(200, { card: card });
      }
      return reply(200, { card: await deliverGiftCard(code) });
    }

    return reply(400, { error: "Unknown action." });
  } catch (e) {
    console.error("gift-cards-admin failed:", e && e.message);
    return reply(500, { error: (e && e.message) || "Something went wrong." });
  }
};
