const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

// Gift cards live in their own Netlify Blobs store, one JSON blob per card:
//
//   card/<CODE>        the card — amounts in cents:
//                      { code, amount, balance, createdAt, purchaseSession,
//                        buyer: {name, email}, recipient: {name, email},
//                        message, deliverOn, deliveredAt, buyerEmailedAt,
//                        holds: { holdId: cents }, history: [...] }
//   session/<id>       which code a gift card purchase (Checkout Session)
//                      issued, so a retried Stripe webhook never issues twice
//   pending/<CODE>     cards waiting for their delivery date — see
//                      deliver-gift-cards.js
//
// Balances use the same conditional-write pattern as stock (see
// inventory-store.js): a checkout holds the amount it's applying, then the
// webhook either finalizes the hold (paid) or releases it (expired unpaid),
// so two checkouts can't both spend the same balance.

// No 0/O or 1/I, so a code read aloud or typed from a phone can't be
// mistaken. 32 letters, so each random byte maps evenly (256 % 32 == 0).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function giftStore() {
  // Same manual site ID + token setup as inventory-store.js.
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: "gift-cards", consistency: "strong", siteID, token });
  }
  return getStore({ name: "gift-cards", consistency: "strong" });
}

// e.g. UAC-7KQ2-M9XD-R4TP — 12 random characters (60 bits), too many to guess.
function newCode() {
  const bytes = crypto.randomBytes(12);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % 32];
  return "UAC-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}

// Accepts a code however it was typed ("uac 7kq2m9xdr4tp", with or without
// dashes) and returns it in UAC-XXXX-XXXX-XXXX form, or null if it can't
// be one.
function normalizeCode(input) {
  let s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("UAC")) s = s.slice(3);
  if (s.length !== 12) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return "UAC-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}

// Today's date in California (YYYY-MM-DD) — delivery dates are Pacific time.
function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

async function getCard(code) {
  return await giftStore().get("card/" + code, { type: "json" });
}

async function saveCard(card) {
  await giftStore().setJSON("card/" + card.code, card);
}

// Reads a card, applies change(card) — which edits it in place, or returns
// false to leave it alone — and writes it back only if nobody else wrote in
// between, retrying against a fresh read if they did. Returns the updated
// card, null if the card doesn't exist, or false if change() declined.
async function updateCard(code, change) {
  const store = giftStore();
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await store.getWithMetadata("card/" + code, { type: "json" });
    if (!result || !result.data) return null;
    const card = result.data;
    if (change(card) === false) return false;
    const { modified } = await store.setJSON("card/" + code, card, { onlyIfMatch: result.etag });
    if (modified) return card;
  }
  throw new Error("Gift card " + code + " is busy — please try again.");
}

// Holds `cents` of the balance for a checkout. Returns the card, or null if
// it doesn't exist or doesn't have that much left.
async function holdBalance(code, holdId, cents) {
  const card = await updateCard(code, (c) => {
    if (c.balance < cents) return false;
    c.balance -= cents;
    c.holds = c.holds || {};
    c.holds[holdId] = cents;
  });
  return card || null;
}

// The checkout was paid — the held amount is spent. Safe to call twice.
async function finalizeHold(code, holdId, sessionId) {
  return updateCard(code, (c) => {
    const cents = c.holds && c.holds[holdId];
    if (!cents) return false;
    delete c.holds[holdId];
    c.history = c.history || [];
    c.history.push({ at: new Date().toISOString(), type: "redeem", amount: -cents, session: sessionId });
  });
}

// The checkout expired or failed — give the held amount back. Safe to call
// twice.
async function releaseHold(code, holdId) {
  return updateCard(code, (c) => {
    const cents = c.holds && c.holds[holdId];
    if (!cents) return false;
    delete c.holds[holdId];
    c.balance += cents;
  });
}

// Claims the code for a gift card purchase, once per Checkout Session.
// Returns { code, isNew } — isNew is false when a retried webhook already
// claimed one, so the caller picks up where the earlier attempt left off.
async function claimPurchaseCode(sessionId) {
  const store = giftStore();
  const existing = await store.get("session/" + sessionId);
  if (existing) return { code: existing, isNew: false };
  const code = newCode();
  const { modified } = await store.set("session/" + sessionId, code, { onlyIfNew: true });
  if (modified) return { code, isNew: true };
  return { code: await store.get("session/" + sessionId), isNew: false };
}

async function markPending(code, deliverOn) {
  await giftStore().set("pending/" + code, deliverOn);
}

async function clearPending(code) {
  await giftStore().delete("pending/" + code);
}

async function listPendingCodes() {
  const { blobs } = await giftStore().list({ prefix: "pending/" });
  return blobs.map((b) => b.key.slice("pending/".length));
}

async function listCards() {
  const store = giftStore();
  const { blobs } = await store.list({ prefix: "card/" });
  const cards = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return cards.filter(Boolean);
}

module.exports = {
  normalizeCode,
  pacificToday,
  getCard,
  saveCard,
  updateCard,
  holdBalance,
  finalizeHold,
  releaseHold,
  claimPurchaseCode,
  markPending,
  clearPending,
  listPendingCodes,
  listCards,
};
