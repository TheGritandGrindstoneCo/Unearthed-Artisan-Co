// Creates a Stripe Checkout Session from the cart contents sent by script.js.
// Runs server-side (Netlify Function) because the Stripe secret key must never
// reach the browser. Set STRIPE_SECRET_KEY in Netlify's Environment Variables —
// never commit it to the repo.
const crypto = require("crypto");
const Stripe = require("stripe");
const { SCENT_IDS, SCENT_NAMES, readInventory, reserveStock, releaseStock } = require("./lib/inventory-store");
const { normalizeCode, getCard, holdBalance, releaseHold } = require("./lib/gift-card-store");
const UACCatalog = require("../../catalog.js");

function badRequest(message) {
  return { statusCode: 400, body: JSON.stringify({ error: message }) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Stripe isn't configured yet — missing STRIPE_SECRET_KEY." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  // Prices and shipping are recalculated here from catalog.js rather than
  // taken from the browser, so they can't be edited down before paying.
  // Only which products (and how many) come from the cart. Sales tax is
  // calculated by Stripe Tax from the address entered at checkout.
  if (items.some((item) => UACCatalog.linePrice(item) === null)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Something in your bag is no longer available. Please remove it and try again." }),
    };
  }
  const method = payload.method === "delivery" ? "delivery" : "shipping";
  const shippingLabel = method === "delivery" ? "Local Delivery" : "Standard Shipping";
  const subtotal = UACCatalog.subtotalOf(items);
  const shippingCost = UACCatalog.shippingCost(items, method, subtotal);
  const siteUrl = (payload.siteUrl || "").replace(/\/$/, "");

  if (items.length === 0 || !siteUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Your bag is empty." }) };
  }

  // A gift card from the bag's Gift Card field. The shipping ZIP comes with
  // it, because the card pays toward sales tax too — so tax has to be known
  // before Stripe's page opens (see the gift card section below).
  let giftCard = null;
  let giftZip = "";
  if (payload.giftCode) {
    const giftCode = normalizeCode(payload.giftCode);
    giftZip = String(payload.giftZip || "").trim();
    if (!giftCode) return badRequest("That gift card code doesn't look right. Please check it and try again.");
    if (!/^\d{5}$/.test(giftZip)) return badRequest("Please enter your 5-digit shipping ZIP code to use your gift card.");
    try {
      giftCard = await getCard(giftCode);
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Could not check your gift card. Please try again." }) };
    }
    if (!giftCard) return badRequest("We couldn't find that gift card code. Please check it and try again.");
    if (giftCard.balance <= 0) return badRequest("That gift card has no balance left. Please remove it to check out.");
  }

  // Sum up how many of each tracked product this order would use — from a
  // single item (item.id is the product slug) and from bundles/gift sets
  // (item.scents lists each product chosen — e.g. a gift set's soap scent,
  // cream, and lip balm picks), so these pull from the same stock pool as
  // buying that item individually. A bundle with qty 2 uses two of each pick.
  const scentIdSet = new Set(SCENT_IDS);
  const deductions = {};
  const addDeduction = (id, qty) => {
    if (!scentIdSet.has(id)) return;
    deductions[id] = (deductions[id] || 0) + qty;
  };
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    if (Array.isArray(item.scents) && item.scents.length > 0) {
      item.scents.forEach((scentId) => addDeduction(scentId, qty));
    } else if (typeof item.id === "string") {
      addDeduction(item.id, qty);
    }
  });

  if (Object.keys(deductions).length > 0) {
    try {
      const currentStock = await readInventory();
      const shortages = Object.keys(deductions).filter((id) => deductions[id] > (currentStock[id] || 0));
      if (shortages.length > 0) {
        const details = shortages
          .map((id) => {
            const available = currentStock[id] || 0;
            const name = SCENT_NAMES[id] || id;
            return available > 0
              ? name + " (only " + available + " left, " + deductions[id] + " in your bag)"
              : name + " (sold out)";
          })
          .join(", ");
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: "Sorry, not enough in stock: " + details + ". Please update your bag and try again.",
            shortages: shortages,
          }),
        };
      }
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Could not check inventory. Please try again." }) };
    }
  }

  const stripe = Stripe(secretKey);

  const line_items = [];
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    const cents = Math.round(UACCatalog.linePrice(item) * 100);
    const name = (item.name || item.id || "Item").toString().slice(0, 250);
    line_items.push({
      quantity: qty,
      price_data: {
        currency: "usd",
        unit_amount: cents,
        // Prices are before tax; Stripe Tax adds tax on top.
        tax_behavior: "exclusive",
        // "General - Tangible Goods" — soap, cream, and lip balm.
        product_data: { name: name, tax_code: "txcd_99999999" },
      },
    });
  });

  // Shipping goes in Stripe's own shipping field rather than as a line item,
  // so Stripe Tax can apply each state's rules for taxing shipping charges
  // and promo codes don't discount it.
  const shipping_options = [
    {
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: shippingLabel,
        fixed_amount: { amount: Math.round(shippingCost * 100), currency: "usd" },
        tax_behavior: "exclusive",
        tax_code: "txcd_92010001", // Shipping
      },
    },
  ];

  if (line_items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Nothing to check out." }) };
  }

  // ---------------- Gift card ----------------
  // A gift card is a payment, not a discount: sales tax is owed on the full
  // price of what it buys. Stripe Checkout figures tax after discounts, so
  // a gift card can't simply be a Stripe coupon on a normal session. Instead,
  // tax is worked out here first (Stripe Tax's calculation API, from the
  // shipping ZIP), and the session is built with shipping and tax as their
  // own lines and Stripe's automatic tax off. The coupon then takes the gift
  // card amount off that full total. The webhook records the calculation as
  // a tax transaction once paid, so it lands in Stripe's tax reports like any
  // other order.
  const shippingCents = Math.round(shippingCost * 100);
  let gift = null;
  if (giftCard) {
    let calc;
    try {
      calc = await stripe.tax.calculations.create({
        currency: "usd",
        line_items: line_items.map((li, i) => ({
          amount: li.price_data.unit_amount * li.quantity,
          quantity: li.quantity,
          reference: "item-" + (i + 1),
          tax_behavior: "exclusive",
          tax_code: "txcd_99999999",
        })),
        shipping_cost: { amount: shippingCents, tax_behavior: "exclusive", tax_code: "txcd_92010001" },
        customer_details: { address: { postal_code: giftZip, country: "US" }, address_source: "shipping" },
      });
    } catch (e) {
      console.error("Tax calculation failed:", e && e.message);
      return badRequest("We couldn't work out sales tax for ZIP code " + giftZip + ". Please check it and try again.");
    }
    gift = {
      code: giftCard.code,
      calc: calc,
      taxCents: calc.tax_amount_exclusive,
      applied: Math.min(giftCard.balance, calc.amount_total),
      holdId: "hold_" + crypto.randomBytes(8).toString("hex"),
      coupon: null,
    };
    if (shippingCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: shippingCents, product_data: { name: shippingLabel } },
      });
    }
    if (gift.taxCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: gift.taxCents, product_data: { name: "Sales Tax" } },
      });
    }
  }

  // The check above reads stock but doesn't reserve it, so two concurrent
  // checkouts on the last unit could otherwise both pass it and both pay.
  // reserveStock() closes that race with an atomic conditional write —
  // whichever request loses the race gets a fresh read and fails here
  // instead. Reserved stock is released again if this session expires
  // unpaid (see the checkout.session.expired handler in stripe-webhook.js)
  // or if anything below fails after the reservation succeeds.
  let reservation = { ok: true, reserved: [] };
  if (Object.keys(deductions).length > 0) {
    reservation = await reserveStock(deductions);
    if (!reservation.ok) {
      await releaseStock(reservation.reserved);
      const name = SCENT_NAMES[reservation.shortageId] || reservation.shortageId;
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: "Sorry, another order just took the last of " + name + ". Please update your bag and try again.",
          shortages: [reservation.shortageId],
        }),
      };
    }
  }

  // The gift card amount is held the same way stock is: taken off the
  // balance now, given back if this session expires unpaid (stripe-webhook.js).
  if (gift) {
    let held = null;
    try {
      held = await holdBalance(gift.code, gift.holdId, gift.applied);
    } catch (e) {
      held = null;
    }
    if (!held) {
      await releaseStock(reservation.reserved);
      return {
        statusCode: 409,
        body: JSON.stringify({ error: "Your gift card's balance just changed. Please apply it again and retry." }),
      };
    }
  }

  const metadata = {
    stock_deductions: JSON.stringify(deductions),
    // Read by export-orders.js to split Pirate Ship labels from the
    // Local Delivery list.
    delivery_method: method,
  };

  const params = {
    mode: "payment",
    success_url: siteUrl + "/checkout-success.html",
    cancel_url: siteUrl + "/shipping.html",
    phone_number_collection: { enabled: true },
    // Local Pickup was removed as an option; Local Delivery and Standard
    // Shipping both need a mailing address.
    shipping_address_collection: { allowed_countries: ["US"] },
    line_items: line_items,
    // Unpaid sessions expire after 30 minutes (Stripe's minimum) so stock
    // reserved above reliably frees up rather than staying locked for the
    // default 24 hours.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    metadata: metadata,
  };

  if (gift) {
    // Shipping and tax are already lines above. A promo code can't be added
    // on top — Stripe allows one discount per session, and it's the card.
    // If the card covers everything, Stripe skips the card form entirely.
    params.custom_text = {
      shipping_address: {
        message: "Sales tax was calculated for ZIP code " + giftZip + ". Please use a shipping address in that ZIP code.",
      },
    };
    Object.assign(metadata, {
      gift_code: gift.code,
      gift_hold: gift.holdId,
      gift_applied: String(gift.applied),
      gift_zip: giftZip,
      tax_calculation: gift.calc.id,
    });
  } else {
    params.shipping_options = shipping_options;
    params.allow_promotion_codes = true;
    // Stripe Tax calculates sales tax from the shipping address the
    // customer enters on Stripe's page — California addresses are taxed at
    // their local rate; other states aren't until a registration is added
    // in the Stripe Dashboard (Tax > Registrations).
    params.automatic_tax = { enabled: true };
  }

  try {
    if (gift) {
      gift.coupon = await stripe.coupons.create({
        amount_off: gift.applied,
        currency: "usd",
        duration: "once",
        max_redemptions: 1,
        name: "Gift Card ending " + gift.code.slice(-4),
      });
      params.discounts = [{ coupon: gift.coupon.id }];
      metadata.gift_coupon = gift.coupon.id;
    }

    const session = await stripe.checkout.sessions.create(params);

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    // Stripe failed after we'd already reserved stock (and maybe a gift card
    // amount) — release them so they aren't stuck with no session to
    // eventually expire them.
    await releaseStock(reservation.reserved);
    if (gift) {
      await releaseHold(gift.code, gift.holdId).catch(() => {});
      if (gift.coupon) await stripe.coupons.del(gift.coupon.id).catch(() => {});
    }
    return { statusCode: 500, body: JSON.stringify({ error: (e && e.message) || "Stripe error." }) };
  }
};
