// Scheduled (see netlify.toml): runs every morning and emails each gift
// card whose delivery date has arrived. Cards for today are usually sent
// right away by the webhook; this catches the ones dated later, plus any
// whose email failed the first time.
const { pacificToday, getCard, listPendingCodes, clearPending } = require("./lib/gift-card-store");
const { deliverGiftCard } = require("./lib/gift-card-issue");

exports.handler = async () => {
  const today = pacificToday();
  let sent = 0;
  for (const code of await listPendingCodes()) {
    try {
      const card = await getCard(code);
      if (!card || card.deliveredAt) {
        await clearPending(code);
        continue;
      }
      if (card.deliverOn > today) continue;
      await deliverGiftCard(code);
      sent++;
    } catch (e) {
      // One bad card shouldn't stop the rest — it stays pending for tomorrow.
      console.error("Gift card delivery failed for " + code + ":", e && e.message);
    }
  }
  console.log("Gift card delivery run: sent " + sent + ".");
  return { statusCode: 200, body: JSON.stringify({ sent: sent }) };
};
