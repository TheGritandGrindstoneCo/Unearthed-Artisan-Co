// ============================================================
// Catalog — the one place product prices, shipping weights, and shipping
// rates live. Loaded by every page (before script.js) and by
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
    // Accessories (Sunniemade, via Faire) — weights from the maker's specs.
    // The flat sisal bag takes no real box room; the 4.2 x 3 x 0.6" dish
    // takes about half a bar's.
    "soap-saver-bag": { kind: "accessory", price: 5.99, oz: 0.5, space: 0 },
    "teak-soap-dish": { kind: "accessory", price: 9.95, oz: 1.9, space: 0.5 },
  };

  // Discount applied to every Ritual card's price (Starter, Daily, and
  // Curated) — same formula everywhere so an identical set of picks always
  // costs the same no matter which Ritual card it's built from.
  const RITUAL_DISCOUNT = 0.1;

  // ---------------- Shipping ----------------
  // Prices are set just above the worst-case (Zone 8 / territories) Pirate
  // Ship rates in Pricing/PirateShip-August-22-2026-USPS-Rates.xlsx:
  //   under 1 lb, any package ........ Ground Advantage   max $8.40  -> $8.95
  //   Medium box (6x4x4, 0.1 cu ft) .. Ground Adv. Cubic  max $10.13 -> $10.95
  //   Large box (8x6x4, 0.2 cu ft) ... Ground Adv. Cubic  max $11.84 -> $12.50
  // USPS holiday surcharge, Oct 4 2026 - Jan 17 2027 (Shipping/Pirate Ship
  // Notification - USPS is raising rates for the holidays on Oct 4th.pdf):
  // +$0.55 in zones 5-9, so the worst cases become $8.95 / $10.68 / $12.39.
  // Medium was raised from $10.50 to $10.95 to stay covered; $8.95 breaks
  // even at worst and Large still covers. Medium can go back to $10.50 after
  // Jan 17 if the regular 2027 rates allow.
  // Cubic pricing only applies when the box dimensions are entered in Pirate
  // Ship. Recheck these prices after each USPS rate change (usually January
  // and July).

  // A single soap, or 1-5 lip balms on their own, go in the sage 4x4x1 gift
  // box (with crinkle paper, sticker, and thank-you card) inside a kraft
  // bubble mailer. dims (here and on BOXES) are outside length x width x
  // height in inches, as entered in Pirate Ship — the order export
  // (export-orders.js) fills them into the label spreadsheet.
  const GIFT_BOX_OZ = 1.0;
  const MAILER_OZ = 0.7;
  const MAX_MAILER_BALMS = 5;
  const MAILER_DIMS = [9, 6, 1.25];
  // Accessories can ride along in the mailer (on their own, or beside the
  // gift box): one teak dish fits next to it, and the flat sisal bags slip
  // in anywhere. More than that goes in a white box.
  const MAX_MAILER_DISHES = 1;
  const MAX_MAILER_BAGS = 3;

  // Everything else goes loose into a white box. FILL_OZ is an allowance for
  // the crinkle paper and card that go in with it. The Small 4x4x4 box isn't
  // listed — USPS won't take anything under 6" long (min 6 x 3 x 0.25"), so
  // orders it would have held ship in the Medium box instead (it's still
  // fine for Local Delivery).
  const FILL_OZ = 1.0;
  const BOXES = [
    { name: "Medium box", oz: 4.1, space: 3, maxCreams: 3, price: 10.95, dims: [6, 4, 4] },
    { name: "Large box", oz: 7.8, space: 10, maxCreams: 10, price: 12.5, dims: [8, 6, 4] },
  ];
  const LARGE = BOXES[BOXES.length - 1];

  const UNDER_1LB_PRICE = 8.95;
  // Compared against the product subtotal before tax and before any Stripe
  // promo code (e.g. THANKYOU10) — see the note on shipping.html.
  const FREE_SHIPPING_MIN = 100;
  const DELIVERY_PRICE = 5;
  const FREE_DELIVERY_MIN = 45;

  // Sales tax isn't calculated here — Stripe Tax works it out from the
  // address entered at checkout (see create-checkout-session.js).

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

  // A Ritual needs at least one soap, cream, or lip balm — accessories can
  // join one, but a set of accessories alone isn't a Ritual (and doesn't get
  // the Ritual discount).
  function ritualHasProduct(slugs) {
    return slugs.some((slug) => PRODUCTS[slug] && PRODUCTS[slug].kind !== "accessory");
  }

  // Ritual price for a set of picks: their sum minus RITUAL_DISCOUNT. null if
  // any pick isn't in the catalog or the set is accessories only.
  function ritualPrice(slugs) {
    if (slugs.length === 0 || slugs.some((slug) => !PRODUCTS[slug])) return null;
    if (!ritualHasProduct(slugs)) return null;
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
    return { box: box.name, oz: oz, dims: box.dims, price: oz < 16 ? UNDER_1LB_PRICE : box.price };
  }

  // Splits the order into the packages it would actually ship in. Orders
  // too big for one Large box fill Large boxes first, then the smallest box
  // that holds what's left.
  function packages(items) {
    const units = unitsIn(items);
    if (units.length === 0) return [];

    const products = units.filter((u) => u.kind !== "accessory");
    const kinds = products.map((u) => u.kind);
    const singleSoap = products.length === 1 && kinds[0] === "soap";
    const onlyBalms = products.length <= MAX_MAILER_BALMS && kinds.every((k) => k === "balm");
    const dishes = units.filter((u) => u === PRODUCTS["teak-soap-dish"]).length;
    const bags = units.filter((u) => u === PRODUCTS["soap-saver-bag"]).length;
    const accessoriesFit = dishes <= MAX_MAILER_DISHES && bags <= MAX_MAILER_BAGS;
    // onlyBalms is also true when the order is accessories alone.
    if ((singleSoap || onlyBalms) && accessoriesFit) {
      return [{ box: "Bubble mailer", oz: sum(units, "oz") + GIFT_BOX_OZ + MAILER_OZ, dims: MAILER_DIMS, price: UNDER_1LB_PRICE }];
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

  const api = {
    PRODUCTS: PRODUCTS,
    priceOf: priceOf,
    ritualPrice: ritualPrice,
    ritualHasProduct: ritualHasProduct,
    linePrice: linePrice,
    subtotalOf: subtotalOf,
    packages: packages,
    shippingCost: shippingCost,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.UACCatalog = api;
  }
})(this);
