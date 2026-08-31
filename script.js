// Unearthed Artisan Co. — shipping & delivery estimator
// Standalone front-end estimate for browsing. The cart module below (bottom
// of this file) uses the same rate table for the actual bag total.

// CA sales tax rate for Simi Valley (93065) — verify against CDTFA's official
// "Find a Sales and Use Tax Rate by Address" tool before relying on this for
// filing; third-party rate aggregators disagreed when this was set.
const CA_TAX_RATE = 0.0725;

(function () {
  const BAR_PRICE = 8.95; // standard bar price; specialty bars ($9.95) run close enough for this estimate

  const RATES = {
    pickup: {
      label: "Local Pickup",
      cost: () => 0,
    },
    delivery: {
      label: "Local Delivery (within ~10 mi of 93065)",
      cost: (subtotal) => (subtotal >= 35 ? 0 : 5),
    },
    shipping: {
      label: "Standard Shipping (USPS, nationwide)",
      cost: (subtotal, qty) => {
        if (subtotal >= 75) return 0;
        // 1-3 bars stay under 1 lb with packaging: USPS Ground Advantage now
        // charges one flat rate for anything under 1 lb (July 2026 update).
        if (qty <= 3) return 8.95;
        // 4-9 bars: USPS Priority Mail Flat Rate Small Box, fixed regardless
        // of exact weight up to 70 lb.
        if (qty <= 9) return 13.65;
        // 10+ bars: Priority Mail Flat Rate Medium Box.
        return 24.8;
      },
    },
  };

  const qtyOutput = document.getElementById("est-qty");
  const decBtn = document.getElementById("est-dec");
  const incBtn = document.getElementById("est-inc");
  const radios = document.querySelectorAll('input[name="est-method"]');
  const subtotalEl = document.getElementById("est-subtotal");
  const shippingEl = document.getElementById("est-shipping");
  const taxEl = document.getElementById("est-tax");
  const totalEl = document.getElementById("est-total");

  if (!qtyOutput) return; // estimator not on this page

  let qty = 4;

  function money(n) {
    return n === 0 ? "Free" : "$" + n.toFixed(2);
  }

  function selectedMethod() {
    const checked = document.querySelector('input[name="est-method"]:checked');
    return checked ? checked.value : "shipping";
  }

  function render() {
    qtyOutput.textContent = qty;
    const subtotal = qty * BAR_PRICE;
    const method = selectedMethod();
    const shippingCost = RATES[method].cost(subtotal, qty);
    // CA tax only applies to Local Pickup/Delivery here — Standard Shipping's
    // destination is unknown until checkout, so it's confirmed at follow-up.
    const taxCost = method === "shipping" ? 0 : subtotal * CA_TAX_RATE;
    const total = subtotal + shippingCost + taxCost;

    subtotalEl.textContent = "$" + subtotal.toFixed(2);
    shippingEl.textContent = money(shippingCost);
    taxEl.textContent = method === "shipping" ? "TBD" : "$" + taxCost.toFixed(2);
    totalEl.textContent = "$" + total.toFixed(2);

    radios.forEach((r) => {
      const amtEl = r.closest(".radio-option").querySelector(".ramt");
      const previewSubtotal = qty * BAR_PRICE;
      amtEl.textContent = money(RATES[r.value].cost(previewSubtotal, qty));
    });
  }

  decBtn.addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    render();
  });
  incBtn.addEventListener("click", () => {
    qty = Math.min(50, qty + 1);
    render();
  });
  radios.forEach((r) => r.addEventListener("change", render));

  render();
})();

// ============================================================
// Cart — add to bag, adjust quantities, live totals.
// Persists to localStorage so the bag survives a page reload.
// Checkout currently emails the order summary (no payment processor
// connected yet) — swap the checkout handler for real Stripe/serverless
// checkout once that's wired up.
// ============================================================
(function () {
  const RATES = {
    pickup: { cost: () => 0 },
    delivery: { cost: (subtotal) => (subtotal >= 35 ? 0 : 5) },
    shipping: {
      cost: (subtotal, qty) => {
        if (subtotal >= 75) return 0;
        if (qty <= 3) return 8.95;
        if (qty <= 9) return 13.65;
        return 24.8;
      },
    },
  };

  const STORAGE_KEY = "uac-cart";
  const ORDER_EMAIL = "unearthedartisanco@gmail.com";

  const toggleBtn = document.getElementById("cart-toggle");
  const closeBtn = document.getElementById("cart-close");
  const overlay = document.getElementById("cart-overlay");
  const drawer = document.getElementById("cart-drawer");
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  const countEl = document.getElementById("cart-count");
  const subtotalEl = document.getElementById("cart-subtotal");
  const shippingEl = document.getElementById("cart-shipping");
  const taxEl = document.getElementById("cart-tax");
  const totalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("cart-checkout");
  const methodRadios = document.querySelectorAll('input[name="cart-method"]');

  if (!drawer) return; // cart not on this page

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

    const qty = totalQty();
    const sub = subtotal();
    const method = selectedMethod();
    const shipCost = qty === 0 ? 0 : RATES[method].cost(sub, qty);
    // CA tax applies to Local Pickup/Delivery (always CA transactions). For
    // Standard Shipping, destination is unknown here, so tax is confirmed
    // at follow-up rather than guessed in the live total.
    const taxApplies = qty > 0 && method !== "shipping";
    const taxCost = taxApplies ? sub * CA_TAX_RATE : 0;
    const total = sub + shipCost + taxCost;

    countEl.textContent = qty;
    countEl.style.display = qty > 0 ? "flex" : "none";
    subtotalEl.textContent = money(sub);
    shippingEl.textContent = qty === 0 ? "—" : money(shipCost);
    taxEl.textContent = qty === 0 ? "—" : method === "shipping" ? "TBD" : money(taxCost);
    totalEl.textContent = money(total);

    methodRadios.forEach((r) => {
      const amtEl = r.closest(".radio-option").querySelector(".ramt");
      amtEl.textContent = money(RATES[r.value].cost(sub, qty));
    });

    if (qty > 0) {
      const lines = cart.map((item) => item.qty + " x " + item.name + " - " + money(item.qty * item.price));
      const methodOption = document.querySelector('input[name="cart-method"]:checked').closest(".radio-option");
      const methodLabel = methodOption.querySelector(".rlabel").textContent.trim();
      const taxLine =
        method === "shipping"
          ? "CA sales tax: TBD — only applies if shipping within California, confirmed when we follow up"
          : "CA sales tax (7.25%): " + money(taxCost);
      const body = [
        "Hi! I'd like to order:",
        "",
        lines.join("\n"),
        "",
        "Subtotal: " + money(sub),
        "Delivery method: " + methodLabel + " (" + money(shipCost) + ")",
        taxLine,
        "Estimated total: " + money(total),
        "",
        "Name:",
        "Address (if shipping or delivery):",
        "Phone:",
      ].join("\n");
      checkoutBtn.href =
        "mailto:" + ORDER_EMAIL + "?subject=" + encodeURIComponent("New order from the website") + "&body=" + encodeURIComponent(body);
      checkoutBtn.classList.remove("is-disabled");
    } else {
      checkoutBtn.href = "#";
      checkoutBtn.classList.add("is-disabled");
    }

    saveCart();
  }

  function addItem(id, name, price) {
    const existing = cart.find((item) => item.id === id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: id, name: name, price: price, qty: 1 });
    }
    render();
    openDrawer();
  }

  // Bundles store qty as the actual bar count (not "1 bundle") so shipping-tier
  // math based on totalQty() still reflects real bar count. price is per-bar
  // (bundle total / bar count), so qty * price still equals the flat bundle price.
  function addBundleItem(name, totalPrice, barQty) {
    cart.push({ id: name + "-" + Date.now(), name: name, price: totalPrice / barQty, qty: barQty });
    render();
    openDrawer();
  }

  function openDrawer() {
    drawer.classList.add("is-open");
    overlay.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  }

  document.querySelectorAll(".add-to-cart").forEach((btn) => {
    btn.addEventListener("click", () => {
      addItem(btn.dataset.id, btn.dataset.name, parseFloat(btn.dataset.price));
    });
  });

  document.querySelectorAll(".add-bundle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selects = btn.closest(".card-body").querySelectorAll(".bundle-select");
      const scents = Array.from(selects).map((s) => s.value);
      const name = btn.dataset.bundleName + ": " + scents.join(", ");
      addBundleItem(name, parseFloat(btn.dataset.bundlePrice), scents.length);
    });
  });

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
  toggleBtn.addEventListener("click", openDrawer);
  closeBtn.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
  checkoutBtn.addEventListener("click", (e) => {
    if (checkoutBtn.classList.contains("is-disabled")) e.preventDefault();
  });

  render();
})();
