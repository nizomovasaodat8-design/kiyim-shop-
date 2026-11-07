// ============================================================
//  DO'KON QISMI: menyu, katalog, kartalar, savat, buyurtma
// ============================================================

const $ = (sel) => document.querySelector(sel);
let activeCat = "all";

// ---------- SAVAT (localStorage'da saqlanadi) ----------
const Cart = {
  items: load(),
  add(id) {
    const row = this.items.find((r) => r.id === id);
    row ? row.qty++ : this.items.push({ id, qty: 1 });
    this.save();
    pulse($("#cartBtn"));
  },
  change(id, d) {
    const row = this.items.find((r) => r.id === id);
    if (!row) return;
    row.qty += d;
    if (row.qty < 1) this.items = this.items.filter((r) => r !== row);
    this.save();
  },
  clear() { this.items = []; this.save(); },
  total() { return this.items.reduce((s, r) => s + byId(r.id).price * r.qty, 0); },
  count() { return this.items.reduce((s, r) => s + r.qty, 0); },
  save() {
    try { localStorage.setItem("kiyim-cart", JSON.stringify(this.items)); } catch {}
    renderCart();
  },
};
window.Cart = Cart;

function load() {
  try {
    const items = JSON.parse(localStorage.getItem("kiyim-cart")) || [];
    return items.filter((r) => byId(r.id)); // o'chirilgan mahsulotlarni tashlab yuboramiz
  } catch { return []; }
}
function byId(id) { return PRODUCTS.find((p) => p.id === id); }
window.byId = byId;

// ---------- MENYU va KATEGORIYALAR ----------
function renderNav() {
  $("#nav").innerHTML = CATEGORIES.slice(1)
    .map((c) => `<a href="#catalog" data-cat="${c.id}">${c.name}</a>`)
    .join("");
  $("#chips").innerHTML = CATEGORIES.map((c) => {
    const n = c.id === "all" ? PRODUCTS.length : PRODUCTS.filter((p) => p.cat === c.id).length;
    return `<button class="chip ${c.id === activeCat ? "is-active" : ""}" data-cat="${c.id}">
              ${c.name} <small>${n}</small></button>`;
  }).join("");
  $("#allCount").textContent = `Barcha ${PRODUCTS.length} ta buyum`;
}

// ---------- MAHSULOT KARTASI ----------
function card(p) {
  return `
    <article class="card">
      <div class="card__img">
        ${p.isNew ? `<span class="tag">Yangi</span>` : ""}
        ${p.sale ? `<span class="tag tag--dark">−20%</span>` : ""}
        <button class="card__fav" aria-label="Sevimli">♡</button>
        <img src="${p.img}" alt="${p.name}" loading="lazy">
        <button class="card__try" data-try="${p.id}">✦ Kiyib ko'rish</button>
      </div>
      <div class="card__info">
        <h4>${p.name}</h4>
        <b>${formatPrice(p.price)}</b>
      </div>
      <div class="card__meta mono">
        <span><i class="dot ${p.live ? "dot--live" : ""}"></i> ${p.live ? "Jonli + AI" : "Faqat AI"}</span>
        <button class="link" data-add="${p.id}">+ Savat</button>
      </div>
    </article>`;
}

function renderGrid() {
  const list = activeCat === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.cat === activeCat);
  $("#grid").innerHTML = list.map(card).join("");
}

function renderHero() {
  $("#heroVisual").innerHTML = [1, 10, 2]
    .map((id, i) => `<div class="hero__card hero__card--${i}" data-try="${id}"><img src="${byId(id).img}" alt=""></div>`)
    .join("");
}

// ---------- BOSISHLAR (hodisa delegatsiyasi) ----------
document.addEventListener("click", (e) => {
  const cat = e.target.closest("[data-cat]");
  if (cat) { activeCat = cat.dataset.cat; renderNav(); renderGrid(); return; }
  const t = e.target.closest("[data-try]");
  if (t) return window.openTryOn?.(+t.dataset.try);
  const a = e.target.closest("[data-add]");
  if (a) return Cart.add(+a.dataset.add);
  const q = e.target.closest("[data-qty]");
  if (q) return Cart.change(+q.dataset.id, +q.dataset.qty);
  const f = e.target.closest(".card__fav");
  if (f) { f.classList.toggle("is-on"); f.textContent = f.classList.contains("is-on") ? "♥" : "♡"; }
});
$("#heroTry").addEventListener("click", () => window.openTryOn?.(1));

// ---------- SAVAT PANELI ----------
function renderCart() {
  $("#cartCount").textContent = Cart.count();
  $("#drawerTotal").textContent = formatPrice(Cart.total());
  $("#checkoutTotal").textContent = formatPrice(Cart.total());
  $("#toCheckout").disabled = !Cart.items.length;
  $("#drawerItems").innerHTML = Cart.items.length
    ? Cart.items.map((r) => {
        const p = byId(r.id);
        return `<div class="line">
          <div class="line__img"><img src="${p.img}" alt=""></div>
          <div class="line__txt"><b>${p.name}</b><span>${formatPrice(p.price * r.qty)}</span></div>
          <div class="qty">
            <button data-qty="-1" data-id="${p.id}">−</button><span>${r.qty}</span><button data-qty="1" data-id="${p.id}">+</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="empty">Savat hozircha bo'sh.</p>`;
}

function showView(name) {
  ["Cart", "Checkout", "Done"].forEach((v) => ($("#view" + v).hidden = v !== name));
  $("#drawerTitle").textContent = { Cart: "Savat", Checkout: "Buyurtma", Done: "" }[name];
}
function openDrawer(open) {
  if (open) showView("Cart");
  $("#drawer").classList.toggle("is-open", open);
  $("#backdrop").classList.toggle("is-open", open);
}
$("#cartBtn").addEventListener("click", () => openDrawer(true));
$("#drawerClose").addEventListener("click", () => openDrawer(false));
$("#backdrop").addEventListener("click", () => openDrawer(false));
$("#doneClose").addEventListener("click", () => openDrawer(false));
$("#toCheckout").addEventListener("click", () => showView("Checkout"));
$("#backToCart").addEventListener("click", () => showView("Cart"));

// ---------- BUYURTMA YUBORISH ----------
$("#viewCheckout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const btn = $("#orderSubmit");
  $("#orderError").textContent = "";
  btn.disabled = true;
  btn.textContent = "Yuborilmoqda…";
  try {
    const r = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        phone: form.get("phone"),
        address: form.get("address"),
        items: Cart.items, // faqat id va soni — narxni server o'zi hisoblaydi
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    $("#orderId").textContent = "#" + data.id;
    Cart.clear();
    e.target.reset();
    showView("Done");
  } catch (err) {
    $("#orderError").textContent =
      err.message === "Failed to fetch" ? "Server bilan aloqa yo'q. “node server.js” ishlayaptimi?" : err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Tasdiqlash";
  }
});

function pulse(el) {
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

// ---------- ISHGA TUSHIRISH ----------
renderNav();
renderHero();
renderGrid();
renderCart();
