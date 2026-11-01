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
  // room it takes in a box — the Large box holds 12 (12 soaps, or 7 soaps +
  // 3 creams + 4 lip balms), but no more than 10 creams.
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
    // Holiday — the two limited bars are sold by the bar on the Holiday
    // shelf and in the Holiday Sets below. The mini cream is only sold in the
    // sets, so its price isn't shown anywhere. It's a 2oz jar, so its oz
    // matches the 2oz facial creams until it's weighed on its own.
    "peppermint-frost": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "alpine-snow": { kind: "soap", price: 10.95, oz: 4.5, space: 1 },
    "mini-body-cream": { kind: "cream", price: 12.99, oz: 5.54, space: 0.5 },
  };

  // Holiday Sets — fixed prices, not the Ritual discount. slots lists, for
  // each item in the set, the products allowed there (one = always
  // included, more = the customer picks; picks come first, in the order of
  // the card's dropdowns, then the card's data-includes). upcharge adds to the price when a
  // pick is chosen — a Stocking Stuffer with the mini cream instead of a
  // soap is $2 more ($18.50 vs $20.50). A negative upcharge is a discount —
  // Quiet Clay, Jade Hollow, and Lavender Dawn make it $17.50.
  const BALMS = ["vanilla-lip-balm", "peppermint-lip-balm", "guava-lip-balm"];
  const SOAPS = Object.keys(PRODUCTS).filter((slug) => PRODUCTS[slug].kind === "soap");
  const SETS = {
    "holiday-gift-set": {
      price: 54,
      slots: [BALMS, ["alpine-snow"], ["peppermint-frost"], ["mini-body-cream"], ["teak-soap-dish"]],
    },
    "stocking-stuffer": {
      price: 18.5,
      slots: [BALMS, SOAPS.concat("mini-body-cream")],
      upcharge: { "mini-body-cream": 2, "quiet-clay": -1, "jade-hollow": -1, "lavender-dawn": -1 },
    },
  };

  // Preorder ship dates, by product slug — shown on the shop cards and in
  // the bag (script.js), and on the packing slip email. Soap dates come from
  // the Batch Tracking Log's cure-ready dates (42-day cure), floored at the
  // October 10, 2026 launch date; lotion and lip balm don't need to cure, so
  // they all ship that same launch date. Golden Harvest and Emerald Meadow
  // were poured later (9/10) so their cure finishes later too. Update this
  // table each time a new soap batch is poured — see Batch Tracking Log.xlsx.
  // Lavender Dawn and Lavender Bloom sold out their first batches, so they're
  // back on preorder from batch #2 (Lavender Bloom poured 9/27, Lavender Dawn
  // 10/4).
  const SHIP_DATES = {
    "quiet-clay": "2026-10-10",
    "jade-hollow": "2026-10-10",
    "lavender-dawn": "2026-11-15",
    "lilac-bloom": "2026-11-08",
    "garnet-dusk": "2026-10-10",
    "indigo-grove": "2026-10-10",
    "onyx-ember": "2026-10-10",
    "golden-harvest": "2026-10-22",
    "emerald-meadow": "2026-10-22",
    "lavender-tallow-lotion": "2026-10-10",
    "frankincense-facial-lotion": "2026-10-10",
    "unscented-body-cream": "2026-10-10",
    "unscented-facial-cream": "2026-10-10",
    "vanilla-lip-balm": "2026-10-10",
    "peppermint-lip-balm": "2026-10-10",
    "guava-lip-balm": "2026-10-10",
    // Accessories are bought in, not made — ship with the launch.
    "soap-saver-bag": "2026-10-10",
    "teak-soap-dish": "2026-10-10",
    // Holiday — Peppermint Frost's cure finishes 11/14 and Alpine Snow's
    // 11/16, so every Holiday Set ships the week of November 16 (the set
    // dates cover a Stocking Stuffer built from a soap that's ready now).
    "peppermint-frost": "2026-11-16",
    "alpine-snow": "2026-11-16",
    "mini-body-cream": "2026-11-16",
    "holiday-gift-set": "2026-11-16",
    "stocking-stuffer": "2026-11-16",
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
    { name: "Large box", oz: 7.8, space: 12, maxCreams: 10, price: 12.5, dims: [8, 6, 4] },
  ];
  const LARGE = BOXES[BOXES.length - 1];

  const UNDER_1LB_PRICE = 8.95;
  // Compared against the product subtotal before tax and before any promo
  // code (THANKYOU10 on Stripe's page, or a bag code from PROMOS below) —
  // see the note on shipping.html.
  const FREE_SHIPPING_MIN = 100;
  const DELIVERY_PRICE = 5;
  const FREE_DELIVERY_MIN = 45;

  // Gift cards (gift-cards.html, create-gift-card-session.js): the preset
  // amounts, plus any other whole-dollar amount between min and max.
  const GIFT_CARD = { presets: [50, 100, 150], min: 10, max: 500 };

  // Promo codes for the bag's Promo Code field (shipping.html). Each takes
  // `percent` off regular items only — never a Holiday Set or anything in
  // HOLIDAY_ONLY — from `starts` to `ends` (California dates, inclusive).
  // They're posted publicly, so unlike the family shipping code they're kept
  // here in plain text. A code typed on Stripe's own page (THANKYOU10) can't
  // be limited to some items, so Stripe's box is off while one of these is
  // applied (create-checkout-session.js).
  const PROMOS = {
    BLACKFRIDAY10: { percent: 10, starts: "2026-11-27", ends: "2026-11-30", name: "Black Friday 10% off" },
  };
  const HOLIDAY_ONLY = ["peppermint-frost", "alpine-snow", "mini-body-cream"];

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

  // Holiday Set price for a set slug and its items (in slot order). null if
  // the set doesn't exist or any item isn't allowed in its slot.
  function setPrice(setId, slugs) {
    const set = SETS[setId];
    if (!set || slugs.length !== set.slots.length) return null;
    if (slugs.some((slug, i) => !set.slots[i].includes(slug))) return null;
    const extra = slugs.reduce((total, slug) => total + ((set.upcharge && set.upcharge[slug]) || 0), 0);
    return roundCents(set.price + extra);
  }

  // Each-price of one cart line — a plain product (item.id is its slug), a
  // Holiday Set (item.set is its slug, item.scents its items), or a Ritual
  // (item.scents lists its picks). null if anything in it isn't in the
  // catalog.
  function linePrice(item) {
    if (item.set) return isBundle(item) ? setPrice(item.set, item.scents) : null;
    return isBundle(item) ? ritualPrice(item.scents) : priceOf(item.id);
  }

  function subtotalOf(items) {
    return roundCents(items.reduce((total, item) => total + qtyOf(item) * (linePrice(item) || 0), 0));
  }

  // A promo code checked against a day (YYYY-MM-DD): { code, promo } when it
  // can be used that day, or { error } saying why not.
  function checkPromo(code, todayIso) {
    const key = String(code || "").trim().toUpperCase();
    const promo = PROMOS[key];
    if (!promo) return { error: "That promo code isn't valid." };
    if (todayIso < promo.starts) {
      const starts = new Date(promo.starts + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
      return { error: "That code starts " + starts + "." };
    }
    if (todayIso > promo.ends) return { error: "That code has ended." };
    return { code: key, promo: promo };
  }

  // Whether a cart line takes promo codes: not a Holiday Set, and nothing
  // in it (a Ritual's picks too) is a holiday-only product.
  function promoEligible(item) {
    if (item.set) return false;
    const slugs = isBundle(item) ? item.scents : [item.id];
    return !slugs.some((slug) => HOLIDAY_ONLY.includes(slug));
  }

  // Dollars a promo takes off the cart: its percent of the eligible lines.
  function promoDiscount(items, promo) {
    const eligible = subtotalOf(items.filter(promoEligible));
    return roundCents((eligible * promo.percent) / 100);
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
      let creams = 0;
      remaining = remaining.filter((u) => {
        if (space + u.space > LARGE.space) return true;
        if (u.kind === "cream" && creams >= LARGE.maxCreams) return true;
        space += u.space;
        if (u.kind === "cream") creams++;
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
    GIFT_CARD: GIFT_CARD,
    SHIP_DATES: SHIP_DATES,
    SETS: SETS,
    priceOf: priceOf,
    setPrice: setPrice,
    ritualPrice: ritualPrice,
    ritualHasProduct: ritualHasProduct,
    linePrice: linePrice,
    subtotalOf: subtotalOf,
    checkPromo: checkPromo,
    promoEligible: promoEligible,
    promoDiscount: promoDiscount,
    packages: packages,
    shippingCost: shippingCost,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.UACCatalog = api;
  }
})(this);
