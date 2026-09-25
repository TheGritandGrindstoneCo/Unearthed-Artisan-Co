// Maps the display names shown on soap "Add to Bag" buttons and in
// bundle/gift-set dropdowns (soap scents, and — for the gift set — cream
// and lip balm picks) to the slug ids used for inventory tracking. Shared by
// the sold-out marking below and the cart logic further down this file.
const SCENT_SLUGS = {
  "Quiet Clay": "quiet-clay",
  "Jade Hollow": "jade-hollow",
  "Lavender Dawn": "lavender-dawn",
  "Lavender Bloom": "lilac-bloom",
  "Garnet Dusk": "garnet-dusk",
  "Indigo Grove": "indigo-grove",
  "Onyx Ember": "onyx-ember",
  "Golden Harvest": "golden-harvest",
  "Emerald Meadow": "emerald-meadow",
  "Lavender Tallow Body Cream": "lavender-tallow-lotion",
  "Frankincense Tallow Facial Cream": "frankincense-facial-lotion",
  "Unscented Tallow Body Cream": "unscented-body-cream",
  "Unscented Tallow Facial Cream": "unscented-facial-cream",
  "Vanilla": "vanilla-lip-balm",
  "Peppermint": "peppermint-lip-balm",
  "Guava": "guava-lip-balm",
  "Teak Soap Dish": "teak-soap-dish",
  "Sisal Soap Saver Bag": "soap-saver-bag",
};

// Populated by the stock-marking block below once /get-inventory resolves.
// Read by the Mix & Match card so rows added later (via "+ Add Another
// Item") also come in pre-marked for anything already sold out.
let STOCK = {};

// Options for the Mix & Match card's per-slot dropdown, grouped the same way
// the shop shelves are. Shared by the initial slots and any slot added via
// "+ Add Another Item".
const MIX_MATCH_GROUPS = [
  { label: "Soap", items: ["Quiet Clay", "Jade Hollow", "Lavender Dawn", "Lavender Bloom", "Garnet Dusk", "Indigo Grove", "Onyx Ember", "Golden Harvest", "Emerald Meadow"] },
  { label: "Tallow Cream", items: ["Lavender Tallow Body Cream", "Frankincense Tallow Facial Cream", "Unscented Tallow Body Cream", "Unscented Tallow Facial Cream"] },
  { label: "Lip Balm", items: ["Vanilla", "Peppermint", "Guava"] },
  { label: "Accessories", items: ["Teak Soap Dish", "Sisal Soap Saver Bag"] },
];

// Preorder ship dates, keyed by the same product slug used in SCENT_SLUGS.
// Soap dates come from the Batch Tracking Log's cure-ready dates (42-day
// cure), floored at the October 10, 2026 launch date; lotion and lip balm
// don't need to cure, so they all ship that same launch date. Golden
// Harvest and Emerald Meadow were poured later (9/10) so their cure
// finishes later too. Update this table each time a new soap batch is
// poured — see Batch Tracking Log.xlsx.
const SHIP_DATES = {
  "quiet-clay": "2026-10-10",
  "jade-hollow": "2026-10-10",
  "lavender-dawn": "2026-10-10",
  "lilac-bloom": "2026-10-10",
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
};

function shipDateLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return "Ships " + d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

// Latest (slowest) ship date among a set of product slugs — used so a
// Ritual, or a whole cart, ships on whichever item takes longest to cure
// (everything in one order ships together, see shipping.html).
function maxShipDateIsoFromSlugs(slugs) {
  let maxIso = null;
  slugs.forEach((slug) => {
    const iso = slug && SHIP_DATES[slug];
    if (iso && (!maxIso || iso > maxIso)) maxIso = iso;
  });
  return maxIso;
}

// Same, but takes the product display names shown in a bundle's dropdowns.
function maxShipDateIso(names) {
  return maxShipDateIsoFromSlugs(names.map((name) => SCENT_SLUGS[name]));
}

// ============================================================
// Product stock — marks sold-out soap, cream, and lip balm items on the
// shop page, both on the "Add to Bag" buttons and inside bundle/gift-set
// scent dropdowns. Only runs where those exist (shop.html).
// ============================================================
(function () {
  const buttons = document.querySelectorAll(".add-to-cart[data-id]");
  const selects = document.querySelectorAll(".bundle-select");
  if (buttons.length === 0 && selects.length === 0) return;

  fetch("/.netlify/functions/get-inventory")
    .then((res) => res.json())
    .then((data) => {
      // The public endpoint only lists sold-out ids (never counts), so mark
      // each of those as 0 — everything below just checks for <= 0.
      const stock = {};
      (data.soldOut || []).forEach((id) => {
        stock[id] = 0;
      });
      STOCK = stock;

      buttons.forEach((btn) => {
        const count = stock[btn.dataset.id];
        if (typeof count === "number" && count <= 0) {
          btn.disabled = true;
          btn.textContent = "Sold Out";
          btn.classList.add("is-sold-out");
        }
      });

      selects.forEach((select) => {
        Array.from(select.options).forEach((option) => {
          const slug = SCENT_SLUGS[option.textContent.trim()];
          const count = slug ? stock[slug] : undefined;
          if (typeof count === "number" && count <= 0) {
            option.disabled = true;
            option.textContent += " (Sold Out)";
          }
        });
        // If the option preselected in the page markup turned out to be sold
        // out, move the selection to the first scent that's still in stock.
        if (select.selectedOptions[0] && select.selectedOptions[0].disabled) {
          const firstAvailable = Array.from(select.options).find((o) => !o.disabled);
          if (firstAvailable) select.value = firstAvailable.value;
        }
      });

      // If every scent in one of a bundle/gift set's dropdowns is sold out,
      // there's no valid pick left for that slot — disable the whole "Add to
      // Bag" button for that card rather than leave a broken selection.
      document.querySelectorAll(".add-giftset, .add-mixmatch").forEach((btn) => {
        const cardSelects = btn.closest(".card-body").querySelectorAll(".bundle-select");
        const blocked = Array.from(cardSelects).some((select) =>
          Array.from(select.options).every((o) => o.disabled)
        );
        if (blocked) {
          btn.disabled = true;
          btn.textContent = "Sold Out";
          btn.classList.add("is-sold-out");
        }
      });
    })
    .catch(() => {
      // If inventory can't be reached, leave everything as-is rather than
      // blocking sales over a transient network issue.
    });
})();

// ============================================================
// Preorder ship-date badges — shows each product card's "Ships [date]"
// line from SHIP_DATES. Static data, so this runs immediately rather than
// waiting on the inventory fetch above.
// ============================================================
(function () {
  document.querySelectorAll(".add-to-cart[data-id]").forEach((btn) => {
    const card = btn.closest(".card-body");
    const shipEl = card ? card.querySelector(".ship-date") : null;
    if (!shipEl) return;
    const label = shipDateLabel(SHIP_DATES[btn.dataset.id]);
    if (label) shipEl.textContent = label;
  });
})();

// ============================================================
// Mobile nav toggle
// ============================================================
(function () {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  links.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      links.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
})();

// ============================================================
// Cart — add to bag on any page, review and check out on shipping.html.
// Persists to localStorage so the bag survives a page reload.
// Checkout hands off to Stripe via a Netlify serverless function.
// Prices and shipping come from catalog.js (UACCatalog), which every
// page loads before this file — the server recalculates both from it.
// ============================================================
(function () {
  const STORAGE_KEY = "uac-cart";
  const ORDER_EMAIL = "unearthedartisanco@gmail.com";

  const countEl = document.getElementById("cart-count");
  if (!countEl) return; // no cart icon on this page (e.g. the preorder teaser)

  // These only exist on shipping.html — everywhere else, only the badge count updates.
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  const subtotalEl = document.getElementById("cart-subtotal");
  const shippingEl = document.getElementById("cart-shipping");
  const taxEl = document.getElementById("cart-tax");
  const totalEl = document.getElementById("cart-total");
  const shipDateEl = document.getElementById("cart-ship-date");
  const checkoutBtn = document.getElementById("cart-checkout");
  const methodRadios = document.querySelectorAll('input[name="cart-method"]');
  const onCartPage = !!itemsEl;

  let cart = loadCart();

  // Re-prices every saved line from catalog.js, so a bag saved before a
  // price change shows what checkout will actually charge, and drops
  // anything that's no longer sold.
  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => {
        const price = UACCatalog.linePrice(item);
        if (price === null) return false;
        item.price = price;
        return true;
      });
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      /* private browsing / storage blocked — cart just won't persist */
    }
  }

  function money(n) {
    return "$" + n.toFixed(2);
  }

  function selectedMethod() {
    const checked = document.querySelector('input[name="cart-method"]:checked');
    return checked ? checked.value : "shipping";
  }

  function totalQty() {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }

  function subtotal() {
    return cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  }

  // A single item's own ship date — a bundle ships on whichever of its
  // picks (item.scents) cures slowest, a plain item ships on its own slug.
  function itemShipDateIso(item) {
    if (Array.isArray(item.scents) && item.scents.length > 0) {
      return maxShipDateIsoFromSlugs(item.scents);
    }
    return SHIP_DATES[item.id] || null;
  }

  // The whole order ships together in one shipment (see the shipping.html
  // copy), so its ship date is the latest among every line item.
  function cartShipDateIso() {
    let maxIso = null;
    cart.forEach((item) => {
      const iso = itemShipDateIso(item);
      if (iso && (!maxIso || iso > maxIso)) maxIso = iso;
    });
    return maxIso;
  }

  function render() {
    const qty = totalQty();
    countEl.textContent = qty;
    countEl.style.display = qty > 0 ? "flex" : "none";
    saveCart();

    if (!onCartPage) return;

    itemsEl.innerHTML = "";

    if (cart.length === 0) {
      emptyEl.style.display = "block";
      itemsEl.appendChild(emptyEl);
    } else {
      emptyEl.style.display = "none";
      cart.forEach((item) => {
        const row = document.createElement("div");
        row.className = "cart-item";
        row.innerHTML =
          '<div class="cart-item-info">' +
          '<p class="cart-item-name"></p>' +
          '<p class="cart-item-price"></p>' +
          '<p class="cart-item-ship ship-date"></p>' +
          "</div>" +
          '<div class="cart-item-controls">' +
          '<button type="button" class="cart-qty-btn" data-action="dec" aria-label="Decrease quantity">&minus;</button>' +
          '<span class="cart-item-qty"></span>' +
          '<button type="button" class="cart-qty-btn" data-action="inc" aria-label="Increase quantity">+</button>' +
          '<button type="button" class="cart-remove" data-action="remove">Remove</button>' +
          "</div>";
        row.querySelector(".cart-item-name").textContent = item.name;
        row.querySelector(".cart-item-price").textContent = money(item.price) + " each";
        row.querySelector(".cart-item-qty").textContent = item.qty;
        const shipLabel = shipDateLabel(itemShipDateIso(item));
        if (shipLabel) row.querySelector(".cart-item-ship").textContent = shipLabel;
        row.querySelectorAll("button[data-action]").forEach((btn) => {
          btn.dataset.id = item.id;
        });
        itemsEl.appendChild(row);
      });
    }

    const sub = subtotal();
    const method = selectedMethod();
    const shipCost = UACCatalog.shippingCost(cart, method, sub);
    // Sales tax depends on the delivery address, which Stripe collects on its
    // checkout page, so it's added there (Stripe Tax) rather than here.
    const total = sub + shipCost;

    subtotalEl.textContent = money(sub);
    shippingEl.textContent = qty === 0 ? "—" : money(shipCost);
    taxEl.textContent = qty === 0 ? "—" : "At checkout";
    totalEl.textContent = money(total);

    if (shipDateEl) {
      const label = shipDateLabel(cartShipDateIso());
      shipDateEl.textContent = label || "";
      shipDateEl.hidden = qty === 0 || !label;
    }

    methodRadios.forEach((r) => {
      const amtEl = r.closest(".radio-option").querySelector(".ramt");
      amtEl.textContent = qty === 0 ? "—" : money(UACCatalog.shippingCost(cart, r.value, sub));
    });

    if (qty > 0) {
      checkoutBtn.classList.remove("is-disabled");
    } else {
      checkoutBtn.classList.add("is-disabled");
    }
  }

  // The price always comes from catalog.js — a plain item's slug, or a
  // Ritual's picks (scents) — never from the page.
  function addItem(id, name, scents) {
    // Items carrying a scents list (the Rituals) always get a fresh cart
    // line, since re-picking a different scent shouldn't merge with a
    // previous pick under the same id.
    const existing = !scents ? cart.find((item) => item.id === id) : null;
    if (existing) {
      existing.qty += 1;
    } else {
      const entry = { id: id, name: name, qty: 1 };
      if (scents) entry.scents = scents;
      entry.price = UACCatalog.linePrice(entry);
      if (entry.price === null) return;
      cart.push(entry);
    }
    render();
  }

  document.querySelectorAll(".add-to-cart").forEach((btn) => {
    btn.addEventListener("click", () => {
      addItem(btn.dataset.id, btn.dataset.name);
    });
  });

  // Shop card prices ("Per bar $9.95") come from catalog.js too, so the
  // price shown always matches what's charged. The price typed in the page
  // markup is just a fallback if this script doesn't run.
  document.querySelectorAll(".add-to-cart[data-id]").forEach((btn) => {
    const price = UACCatalog.priceOf(btn.dataset.id);
    const priceEl = btn.closest(".card-foot") && btn.closest(".card-foot").querySelector(".card-price");
    if (price === null || !priceEl || !priceEl.lastChild || priceEl.lastChild.nodeType !== Node.TEXT_NODE) return;
    priceEl.lastChild.textContent = money(price);
  });

  // Starter Ritual and Daily Ritual — live-priced the same way as Curated
  // Ritual (UACCatalog.ritualPrice: sum of the picks minus the Ritual
  // discount), so an identical set of picks costs the same no matter which
  // Ritual card it's built from.
  document.querySelectorAll(".add-giftset").forEach((btn) => {
    const selects = btn.closest(".card-body").querySelectorAll(".bundle-select");
    const totalEl = btn.closest(".card-body").querySelector(".ritual-total");
    const shipEl = btn.closest(".card-body").querySelector(".ship-date");

    function recalcGiftset() {
      const slugs = Array.from(selects).map((s) => SCENT_SLUGS[s.value]);
      if (totalEl) totalEl.textContent = money(UACCatalog.ritualPrice(slugs) || 0);
      if (shipEl) shipEl.textContent = shipDateLabel(maxShipDateIso(Array.from(selects).map((s) => s.value)));
    }

    selects.forEach((s) => s.addEventListener("change", recalcGiftset));
    recalcGiftset();

    btn.addEventListener("click", () => {
      const picks = Array.from(selects).map((s) => s.value);
      // Each select sits in a <label>Slot Name<select>...</select></label> —
      // pull the slot name (e.g. "Soap", "Body Cream") to build a readable
      // line-item name without hardcoding how many picks a set has.
      const slots = Array.from(selects).map((s) => {
        const clone = s.closest("label").cloneNode(true);
        clone.querySelector("select").remove();
        return clone.textContent.trim();
      });
      const name = btn.dataset.setName + ": " + slots.map((slot, i) => slot + " - " + picks[i]).join(", ");
      // Deduct one of each picked item's own stock from its respective pool.
      const pickSlugs = picks.map((p) => SCENT_SLUGS[p]).filter(Boolean);
      addItem("giftset-" + Date.now(), name, pickSlugs.length ? pickSlugs : undefined);
    });
  });

  // Mix & Match — pick any 2-5 items, any type, with a live-updating price
  // (UACCatalog.ritualPrice, same as the other Rituals) as slots are added, removed, or
  // changed. Unlike the other bundle cards, slot count isn't fixed, so rows
  // are built and torn down in JS rather than living in the page markup.
  document.querySelectorAll(".mix-match-card").forEach((card) => {
    const picksEl = card.querySelector(".mix-picks");
    const addRowBtn = card.querySelector(".mix-add");
    const countEl2 = card.querySelector(".mix-count");
    const totalEl2 = card.querySelector(".mix-total");
    const shipEl2 = card.querySelector(".ship-date");
    const addToBagBtn = card.querySelector(".add-mixmatch");
    if (!picksEl || !addRowBtn || !countEl2 || !totalEl2 || !addToBagBtn) return;

    const MIN_SLOTS = 2;
    const MAX_SLOTS = 5;
    const ALL_ITEM_NAMES = MIX_MATCH_GROUPS.flatMap((g) => g.items);

    function buildOptions(select) {
      MIX_MATCH_GROUPS.forEach((group) => {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        group.items.forEach((itemName) => {
          const option = document.createElement("option");
          option.textContent = itemName;
          const slug = SCENT_SLUGS[itemName];
          const count = slug ? STOCK[slug] : undefined;
          if (typeof count === "number" && count <= 0) {
            option.disabled = true;
            option.textContent += " (Sold Out)";
          }
          optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
      });
    }

    function makeRow(defaultValue) {
      const row = document.createElement("div");
      row.className = "mix-row";
      const select = document.createElement("select");
      select.className = "bundle-select mix-select";
      buildOptions(select);
      if (defaultValue) select.value = defaultValue;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mix-remove";
      remove.setAttribute("aria-label", "Remove this item");
      remove.textContent = "×";
      row.appendChild(select);
      row.appendChild(remove);
      return row;
    }

    function updateRowControls() {
      const rows = picksEl.querySelectorAll(".mix-row");
      rows.forEach((row) => {
        row.querySelector(".mix-remove").hidden = rows.length <= MIN_SLOTS;
      });
      addRowBtn.hidden = rows.length >= MAX_SLOTS;
    }

    function recalc() {
      const selects = picksEl.querySelectorAll(".mix-select");
      const slugs = Array.from(selects).map((s) => SCENT_SLUGS[s.value]);
      countEl2.textContent = selects.length + (selects.length === 1 ? " item" : " items");
      totalEl2.textContent = money(UACCatalog.ritualPrice(slugs) || 0);
      if (shipEl2) shipEl2.textContent = shipDateLabel(maxShipDateIso(Array.from(selects).map((s) => s.value)));
    }

    picksEl.addEventListener("change", (e) => {
      if (e.target.classList.contains("mix-select")) recalc();
    });

    picksEl.addEventListener("click", (e) => {
      const removeBtn = e.target.closest(".mix-remove");
      if (!removeBtn) return;
      if (picksEl.querySelectorAll(".mix-row").length <= MIN_SLOTS) return;
      removeBtn.closest(".mix-row").remove();
      updateRowControls();
      recalc();
    });

    addRowBtn.addEventListener("click", () => {
      if (picksEl.querySelectorAll(".mix-row").length >= MAX_SLOTS) return;
      const used = Array.from(picksEl.querySelectorAll(".mix-select")).map((s) => s.value);
      const nextDefault = ALL_ITEM_NAMES.find((n) => !used.includes(n)) || ALL_ITEM_NAMES[0];
      picksEl.appendChild(makeRow(nextDefault));
      updateRowControls();
      recalc();
    });

    addToBagBtn.addEventListener("click", () => {
      const picks = Array.from(picksEl.querySelectorAll(".mix-select")).map((s) => s.value);
      const slugs = picks.map((p) => SCENT_SLUGS[p]).filter(Boolean);
      const name = "Curated Ritual: " + picks.join(", ");
      addItem("mixmatch-" + Date.now(), name, slugs.length ? slugs : undefined);
    });

    updateRowControls();
    recalc();
  });

  if (onCartPage) {
    itemsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const item = cart.find((i) => i.id === btn.dataset.id);
      if (!item) return;
      if (btn.dataset.action === "inc") item.qty += 1;
      if (btn.dataset.action === "dec") item.qty = Math.max(1, item.qty - 1);
      if (btn.dataset.action === "remove") cart = cart.filter((i) => i.id !== btn.dataset.id);
      render();
    });

    methodRadios.forEach((r) => r.addEventListener("change", render));

    // Local Delivery only covers specific ZIP codes — gate the radio behind a
    // ZIP check rather than letting anyone select it regardless of location.
    const zipInput = document.getElementById("delivery-zip");
    const zipMsg = document.getElementById("zip-check-msg");
    const deliveryRadio = document.getElementById("delivery-radio");
    const DELIVERY_ZIPS = ["93065", "93062", "93063", "93021"];

    if (zipInput && zipMsg && deliveryRadio) {
      zipInput.addEventListener("input", () => {
        const zip = zipInput.value.trim();

        if (zip.length < 5) {
          deliveryRadio.disabled = true;
          zipMsg.textContent = "";
          zipMsg.className = "zip-check-msg";
        } else if (DELIVERY_ZIPS.includes(zip)) {
          deliveryRadio.disabled = false;
          zipMsg.textContent = "Local delivery is available in your area.";
          zipMsg.className = "zip-check-msg is-eligible";
        } else {
          deliveryRadio.disabled = true;
          zipMsg.textContent = "Local delivery isn't available for that ZIP — Standard Shipping ships nationwide.";
          zipMsg.className = "zip-check-msg is-ineligible";
        }

        if (deliveryRadio.disabled && deliveryRadio.checked) {
          deliveryRadio.checked = false;
          const shippingRadio = document.querySelector('input[name="cart-method"][value="shipping"]');
          if (shippingRadio) shippingRadio.checked = true;
          render();
        }
      });
    }

    checkoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (checkoutBtn.classList.contains("is-disabled")) return;

      const method = selectedMethod();

      const originalText = checkoutBtn.textContent;
      checkoutBtn.textContent = "Redirecting to checkout…";
      checkoutBtn.classList.add("is-disabled");

      try {
        const res = await fetch("/.netlify/functions/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map((item) => ({ id: item.id, name: item.name, price: item.price, qty: item.qty, scents: item.scents })),
            method: method,
            siteUrl: window.location.origin,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error((data && data.error) || "Checkout failed");
        window.location.href = data.url;
      } catch (err) {
        checkoutBtn.textContent = originalText;
        checkoutBtn.classList.remove("is-disabled");
        const message =
          err && err.message && err.message !== "Checkout failed"
            ? err.message
            : "Something went wrong starting checkout. Please try again, or email us directly at " + ORDER_EMAIL + ".";
        alert(message);
      }
    });
  }

  render();
})();
