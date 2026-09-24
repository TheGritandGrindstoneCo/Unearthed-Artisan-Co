// ============================================================
// Catalog — the one place product prices, shipping weights, shipping rates,
// and tax live. Loaded by every page (before script.js) and by
// create-checkout-session.js on the server, so the prices a customer sees
// and the prices Stripe charges always come from the same numbers, and
// can't be edited in the browser before paying.
//
// To change a price, change it here — the shop cards, Ritual totals,
// Shopping Bag, and checkout all pick it up.
// ============================================================
(function (root) {
  // price: retail price. oz: the product alone, as it goes loose into a
  // white box (from Shipping/Product Weights & Measurements.xlsx). space:
  // room it takes in a box — the Large box holds 10 (10 soaps, or 6 soaps +
  // 3 creams + 2 lip balms).
  const PRODUCTS = {
    "quiet-clay": { kind: "soap", price: 9.95, oz: 4.5, space: 1 },
    "jade-hollow": { kind: "soap", price: 9.95, oz: 4.5, space: 1 },
    "lavender-dawn": { kind: "soap", price: 9.95, oz: 4.5, space: 1 },
    "lilac-bloom": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "garnet-dusk": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "indigo-grove": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "onyx-ember": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "golden-harvest": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "emerald-meadow": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "lavender-tallow-lotion": { kind: "cream", price: 24.99, oz: 8.25, space: 1 },
    "frankincense-facial-lotion": { kind: "cream", price: 26.99, oz: 5.54, space: 1 },
    "unscented-body-cream": { kind: "cream", price: 24.99, oz: 8.25, space: 1 },
    "unscented-facial-cream": { kind: "cream", price: 26.99, oz: 5.54, space: 1 },
    "vanilla-lip-balm": { kind: "balm", price: 6.99, oz: 0.35, space: 0.5 },
    "peppermint-lip-balm": { kind: "balm", price: 6.99, oz: 0.35, space: 0.5 },
    "guava-lip-balm": { kind: "balm", price: 6.99, oz: 0.35, space: 0.5 },
  };

  // Discount applied to every Ritual card's price (Starter, Daily, and
  // Curated) — same formula everywhere so an identical set of picks always
  // costs the same no matter which Ritual card it's built from.
  const RITUAL_DISCOUNT = 0.1;

  // ---------------- Shipping ----------------
  // Prices are set just above the worst-case (Zone 8 / territories) Pirate
  // Ship rates in Pricing/PirateShip-August-22-2026-USPS-Rates.xlsx:
  //   under 1 lb, any package ........ Ground Advantage   max $8.40  -> $8.95
  //   Small/Medium box (0.1 cu ft) ... Ground Adv. Cubic  max $10.13 -> $10.50
  //   Large box (8x6x4, 0.2 cu ft) ... Ground Adv. Cubic  max $11.84 -> $12.50
  // Cubic pricing only applies when the box dimensions are entered in Pirate
  // Ship. Recheck these prices after each USPS rate change (usually January
  // and July).

  // A single soap, or 1-5 lip balms on their own, go in the sage 4x4x1 gift
  // box (with crinkle paper, sticker, and thank-you card) inside a kraft
  // bubble mailer.
  const GIFT_BOX_OZ = 1.0;
  const MAILER_OZ = 0.7;
  const MAX_MAILER_BALMS = 5;

  // Everything else goes loose into a white box. FILL_OZ is an allowance for
  // the crinkle paper and card that go in with it.
  const FILL_OZ = 1.0;
  const BOXES = [
    { name: "Small", oz: 2.93, space: 2, maxCreams: 1, price: 10.5 },
    { name: "Medium", oz: 4.1, space: 3, maxCreams: 3, price: 10.5 },
    { name: "Large", oz: 7.8, space: 10, maxCreams: 10, price: 12.5 },
  ];
  const LARGE = BOXES[BOXES.length - 1];

  const UNDER_1LB_PRICE = 8.95;
  // Compared against the product subtotal before tax and before any Stripe
  // promo code (e.g. THANKYOU10) — see the note on shipping.html.
  const FREE_SHIPPING_MIN = 100;
  const DELIVERY_PRICE = 5;
  const FREE_DELIVERY_MIN = 45;

  // CA sales tax rate for Simi Valley (93065) — verify against CDTFA's official
  // "Find a Sales and Use Tax Rate by Address" tool before relying on this for
  // filing; third-party rate aggregators disagreed when this was set.
  const CA_TAX_RATE = 0.0725;

  function qtyOf(item) {
    return Math.max(1, parseInt(item.qty, 10) || 1);
  }

  function roundCents(n) {
    return Math.round(n * 100) / 100;
  }

  function isBundle(item) {
    return Array.isArray(item.scents) && item.scents.length > 0;
  }

  // Retail price of one product, or null if it isn't in the catalog.
  function priceOf(slug) {
    return PRODUCTS[slug] ? PRODUCTS[slug].price : null;
  }

  // Ritual price for a set of picks: their sum minus RITUAL_DISCOUNT.
  function ritualPrice(slugs) {
    if (slugs.length === 0 || slugs.some((slug) => !PRODUCTS[slug])) return null;
    const sum = slugs.reduce((total, slug) => total + PRODUCTS[slug].price, 0);
    return roundCents(sum * (1 - RITUAL_DISCOUNT));
  }

  // Each-price of one cart line — a plain product (item.id is its slug) or a
  // Ritual (item.scents lists its picks). null if anything in it isn't in
  // the catalog.
  function linePrice(item) {
    return isBundle(item) ? ritualPrice(item.scents) : priceOf(item.id);
  }

  function subtotalOf(items) {
    return roundCents(items.reduce((total, item) => total + qtyOf(item) * (linePrice(item) || 0), 0));
  }

  // Every physical product in the cart, one entry per unit — a Ritual
  // contributes each of its picks, times its qty. Anything not in the catalog
  // is treated as a body cream (the heaviest item) so it never ships for less
  // than it costs.
  function unitsIn(items) {
    const units = [];
    items.forEach((item) => {
      const slugs = isBundle(item) ? item.scents : [item.id];
      for (let n = 0; n < qtyOf(item); n++) {
        slugs.forEach((slug) => units.push(PRODUCTS[slug] || PRODUCTS["lavender-tallow-lotion"]));
      }
    });
    return units;
  }

  function sum(units, key) {
    return units.reduce((total, u) => total + u[key], 0);
  }

  function fits(box, units) {
    return sum(units, "space") <= box.space && units.filter((u) => u.kind === "cream").length <= box.maxCreams;
  }

  function boxPackage(box, units) {
    const oz = sum(units, "oz") + box.oz + FILL_OZ;
    return { box: box.name, oz: oz, price: oz < 16 ? UNDER_1LB_PRICE : box.price };
  }

  // Splits the order into the packages it would actually ship in. Orders
  // too big for one Large box fill Large boxes first, then the smallest box
  // that holds what's left.
  function packages(items) {
    const units = unitsIn(items);
    if (units.length === 0) return [];

    const kinds = units.map((u) => u.kind);
    const singleSoap = units.length === 1 && kinds[0] === "soap";
    const onlyBalms = units.length <= MAX_MAILER_BALMS && kinds.every((k) => k === "balm");
    if (singleSoap || onlyBalms) {
      return [{ box: "Bubble mailer", oz: sum(units, "oz") + GIFT_BOX_OZ + MAILER_OZ, price: UNDER_1LB_PRICE }];
    }

    // Biggest items first, so a partly-filled last box holds the small ones.
    let remaining = units.slice().sort((a, b) => b.space - a.space);
    const result = [];
    while (!fits(LARGE, remaining)) {
      const load = [];
      let space = 0;
      remaining = remaining.filter((u) => {
        if (space + u.space > LARGE.space) return true;
        space += u.space;
        load.push(u);
        return false;
      });
      result.push(boxPackage(LARGE, load));
    }
    const box = BOXES.find((b) => fits(b, remaining));
    result.push(boxPackage(box, remaining));
    return result;
  }

  // Shipping/delivery cost for a whole order. subtotal is the product total
  // before shipping and tax.
  function shippingCost(items, method, subtotal) {
    if (items.length === 0) return 0;
    if (method === "delivery") return subtotal >= FREE_DELIVERY_MIN ? 0 : DELIVERY_PRICE;
    if (subtotal >= FREE_SHIPPING_MIN) return 0;
    return roundCents(packages(items).reduce((total, p) => total + p.price, 0));
  }

  // CA sales tax applies to Local Delivery (always a CA transaction). For
  // Standard Shipping the destination isn't known yet, so it's confirmed at
  // follow-up instead.
  function taxCost(items, method, subtotal) {
    return items.length > 0 && method === "delivery" ? roundCents(subtotal * CA_TAX_RATE) : 0;
  }

  const api = {
    PRODUCTS: PRODUCTS,
    priceOf: priceOf,
    ritualPrice: ritualPrice,
    linePrice: linePrice,
    subtotalOf: subtotalOf,
    packages: packages,
    shippingCost: shippingCost,
    taxCost: taxCost,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.UACCatalog = api;
  }
})(this);
