// CA sales tax rate for Simi Valley (93065) — verify against CDTFA's official
// "Find a Sales and Use Tax Rate by Address" tool before relying on this for
// filing; third-party rate aggregators disagreed when this was set.
const CA_TAX_RATE = 0.0725;

// Maps the display names shown on soap "Add to Bag" buttons and in
// bundle/gift-set dropdowns (soap scents, and — for the gift set — cream
// and lip balm picks) to the slug ids used for inventory tracking. Shared by
// the sold-out marking below and the cart logic further down this file.
const SCENT_SLUGS = {
  "Quiet Clay": "quiet-clay",
  "Jade Hollow": "jade-hollow",
  "Lavender Dawn": "lavender-dawn",
  "Lavender Swirl": "lilac-bloom",
  "Garnet Dusk": "garnet-dusk",
  "Indigo Grove": "indigo-grove",
  "Onyx Ember": "onyx-ember",
  "Golden Harvest": "golden-harvest",
  "Emerald Meadow": "emerald-meadow",
  "Lavender Body Cream": "lavender-tallow-lotion",
  "Frankincense Facial Cream": "frankincense-facial-lotion",
  "Unscented Body Cream": "unscented-body-cream",
  "Unscented Facial Cream": "unscented-facial-cream",
  "Vanilla": "vanilla-lip-balm",
  "Peppermint": "peppermint-lip-balm",
  "Guava": "guava-lip-balm",
};

// Per-item retail prices, keyed the same as SCENT_SLUGS. Used to price the
// Mix & Match card live as picks change, and to build its cart line item.
const PRODUCT_PRICES = {
  "Quiet Clay": 9.95,
  "Jade Hollow": 9.95,
  "Lavender Dawn": 9.95,
  "Lavender Swirl": 10.95,
  "Garnet Dusk": 10.95,
  "Indigo Grove": 10.95,
  "Onyx Ember": 10.95,
  "Golden Harvest": 10.95,
  "Emerald Meadow": 10.95,
  "Lavender Body Cream": 24.99,
  "Frankincense Facial Cream": 26.99,
  "Unscented Body Cream": 24.99,
  "Unscented Facial Cream": 26.99,
  "Vanilla": 6.99,
  "Peppermint": 6.99,
  "Guava": 6.99,
};

// Discount applied on the Mix & Match card (any 2-5 items, any type).
const MIX_MATCH_DISCOUNT = 0.1;

// Populated by the stock-marking block below once /get-inventory resolves.
// Read by the Mix & Match card so rows added later (via "+ Add Another
// Item") also come in pre-marked for anything already sold out.
let STOCK = {};

// Options for the Mix & Match card's per-slot dropdown, grouped the same way
// the shop shelves are. Shared by the initial slots and any slot added via
// "+ Add Another Item".
const MIX_MATCH_GROUPS = [
  { label: "Soap", items: ["Quiet Clay", "Jade Hollow", "Lavender Dawn", "Lavender Swirl", "Garnet Dusk", "Indigo Grove", "Onyx Ember", "Golden Harvest", "Emerald Meadow"] },
  { label: "Tallow Cream", items: ["Lavender Body Cream", "Frankincense Facial Cream", "Unscented Body Cream", "Unscented Facial Cream"] },
  { label: "Lip Balm", items: ["Vanilla", "Peppermint", "Guava"] },
];

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
      const stock = data.stock || {};
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
      document.querySelectorAll(".add-bundle, .add-giftset, .add-mixmatch").forEach((btn) => {
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
// ============================================================
(function () {
  const RATES = {
    delivery: { cost: (subtotal) => (subtotal >= 45 ? 0 : 5) },
    shipping: {
      cost: (subtotal, qty) => {
        if (subtotal >= 100) return 0;
        if (qty <= 3) return 8.95;
        if (qty <= 9) return 13.65;
        return 24.8;
      },
    },
  };

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
  const checkoutBtn = document.getElementById("cart-checkout");
  const methodRadios = document.querySelectorAll('input[name="cart-method"]');
  const onCartPage = !!itemsEl;

  let cart = loadCart();

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
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
        row.querySelectorAll("button[data-action]").forEach((btn) => {
          btn.dataset.id = item.id;
        });
        itemsEl.appendChild(row);
      });
    }

    const sub = subtotal();
    const method = selectedMethod();
    const shipCost = qty === 0 ? 0 : RATES[method].cost(sub, qty);
    // CA tax applies to Local Delivery (always a CA transaction). For
    // Standard Shipping, destination is unknown here, so tax is confirmed
    // at follow-up rather than guessed in the live total.
    const taxApplies = qty > 0 && method !== "shipping";
    const taxCost = taxApplies ? sub * CA_TAX_RATE : 0;
    const total = sub + shipCost + taxCost;

    subtotalEl.textContent = money(sub);
    shippingEl.textContent = qty === 0 ? "—" : money(shipCost);
    taxEl.textContent = qty === 0 ? "—" : method === "shipping" ? "TBD" : money(taxCost);
    totalEl.textContent = money(total);

    methodRadios.forEach((r) => {
      const amtEl = r.closest(".radio-option").querySelector(".ramt");
      amtEl.textContent = money(RATES[r.value].cost(sub, qty));
    });

    if (qty > 0) {
      checkoutBtn.classList.remove("is-disabled");
    } else {
      checkoutBtn.classList.add("is-disabled");
    }
  }

  function addItem(id, name, price, scents) {
    // Items carrying a scents list (currently just the gift set) always get
    // a fresh cart line, since re-picking a different scent shouldn't merge
    // with a previous pick under the same id.
    const existing = !scents ? cart.find((item) => item.id === id) : null;
    if (existing) {
      existing.qty += 1;
    } else {
      const entry = { id: id, name: name, price: price, qty: 1 };
      if (scents) entry.scents = scents;
      cart.push(entry);
    }
    render();
  }

  // Bundles store qty as the actual bar count (not "1 bundle") so shipping-tier
  // math based on totalQty() still reflects real bar count. price is per-bar
  // (bundle total / bar count), so qty * price still equals the flat bundle price.
  // scents lists each chosen scent's slug id, one per bar, so a bundle pulls
  // from the same per-scent stock pool as buying that bar individually.
  function addBundleItem(name, totalPrice, barQty, scents) {
    cart.push({ id: name + "-" + Date.now(), name: name, price: totalPrice / barQty, qty: barQty, scents: scents });
    render();
  }

  document.querySelectorAll(".add-to-cart").forEach((btn) => {
    btn.addEventListener("click", () => {
      addItem(btn.dataset.id, btn.dataset.name, parseFloat(btn.dataset.price));
    });
  });

  document.querySelectorAll(".add-bundle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selects = btn.closest(".card-body").querySelectorAll(".bundle-select");
      const scentNames = Array.from(selects).map((s) => s.value);
      const scentSlugs = scentNames.map((n) => SCENT_SLUGS[n]).filter(Boolean);
      const name = btn.dataset.bundleName + ": " + scentNames.join(", ");
      addBundleItem(name, parseFloat(btn.dataset.bundlePrice), scentNames.length, scentSlugs);
    });
  });

  document.querySelectorAll(".add-giftset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selects = btn.closest(".card-body").querySelectorAll(".bundle-select");
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
      addItem("giftset-" + Date.now(), name, parseFloat(btn.dataset.price), pickSlugs.length ? pickSlugs : undefined);
    });
  });

  // Mix & Match — pick any 2-5 items, any type, with a live-updating price
  // (MIX_MATCH_DISCOUNT off the sum) as slots are added, removed, or
  // changed. Unlike the other bundle cards, slot count isn't fixed, so rows
  // are built and torn down in JS rather than living in the page markup.
  document.querySelectorAll(".mix-match-card").forEach((card) => {
    const picksEl = card.querySelector(".mix-picks");
    const addRowBtn = card.querySelector(".mix-add");
    const countEl2 = card.querySelector(".mix-count");
    const totalEl2 = card.querySelector(".mix-total");
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
      const subtotal = Array.from(selects).reduce((sum, s) => sum + (PRODUCT_PRICES[s.value] || 0), 0);
      const discounted = subtotal * (1 - MIX_MATCH_DISCOUNT);
      countEl2.textContent = selects.length + (selects.length === 1 ? " item" : " items") + " — " + Math.round(MIX_MATCH_DISCOUNT * 100) + "% off";
      totalEl2.textContent = money(discounted);
      addToBagBtn.dataset.total = discounted.toFixed(2);
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
      const name = "Mix & Match: " + picks.join(", ");
      addItem("mixmatch-" + Date.now(), name, parseFloat(addToBagBtn.dataset.total), slugs.length ? slugs : undefined);
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

      const sub = subtotal();
      const qty = totalQty();
      const method = selectedMethod();
      const shipCost = RATES[method].cost(sub, qty);
      const taxCost = method === "shipping" ? 0 : sub * CA_TAX_RATE;
      const methodOption = document.querySelector('input[name="cart-method"]:checked').closest(".radio-option");
      const shippingLabel = methodOption.querySelector(".rlabel").textContent.trim();

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
            shippingLabel: shippingLabel,
            shippingCost: shipCost,
            taxCost: taxCost,
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
