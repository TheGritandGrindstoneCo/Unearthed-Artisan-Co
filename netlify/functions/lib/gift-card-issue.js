// Turning a paid gift card purchase into a card, and delivering it. Used by
// stripe-webhook.js (right after purchase), deliver-gift-cards.js (each
// morning, for cards with a later delivery date), and gift-cards-admin.js
// (the "Send now" button on inventory.html).
const {
  pacificToday,
  getCard,
  saveCard,
  updateCard,
  claimPurchaseCode,
  markPending,
  clearPending,
} = require("./gift-card-store");
const { sendRecipientEmail, sendBuyerReceipt } = require("./gift-card-email");

// Emails the card to its recipient and marks it delivered.
async function deliverGiftCard(code) {
  const card = await getCard(code);
  if (!card) return null;
  await sendRecipientEmail(card);
  const updated = await updateCard(code, (c) => {
    c.deliveredAt = new Date().toISOString();
  });
  await clearPending(code);
  return updated;
}

// Called for each completed gift card Checkout Session. Every step checks
// what's already done, so when Stripe retries the webhook after a failure
// (an email that didn't send, say), it finishes the job without issuing a
// second card or emailing anyone twice.
async function issueGiftCard(session) {
  const m = session.metadata || {};
  const { code } = await claimPurchaseCode(session.id);

  let card = await getCard(code);
  if (!card) {
    const cents = parseInt(m.gift_amount, 10);
    if (!Number.isFinite(cents) || cents <= 0) throw new Error("Gift card session " + session.id + " has no amount.");
    const now = new Date().toISOString();
    card = {
      code: code,
      amount: cents,
      balance: cents,
      createdAt: now,
      purchaseSession: session.id,
      buyer: {
        name: m.sender_name || "",
        email: (session.customer_details && session.customer_details.email) || "",
      },
      recipient: { name: m.recipient_name || "", email: m.recipient_email || "" },
      message: m.gift_message || "",
      deliverOn: m.deliver_on || pacificToday(),
      deliveredAt: null,
      buyerEmailedAt: null,
      holds: {},
      history: [{ at: now, type: "purchase", amount: cents, session: session.id }],
    };
    await saveCard(card);
  }

  if (!card.deliveredAt) {
    // Queued first, so if the email below fails, the morning delivery run
    // picks it up even if Stripe stops retrying.
    await markPending(code, card.deliverOn);
    if (card.deliverOn <= pacificToday()) card = await deliverGiftCard(code);
  }

  if (!card.buyerEmailedAt && card.buyer.email) {
    await sendBuyerReceipt(card, !!card.deliveredAt);
    card = await updateCard(code, (c) => {
      c.buyerEmailedAt = new Date().toISOString();
    });
  }
  return card;
}

module.exports = { issueGiftCard, deliverGiftCard };
