// ============================================================
//  DO'KON SOZLAMALARI — yangi mijoz uchun faqat shu faylni o'zgartirasiz
//  (nom, shahar, aloqa, rang). Sayt, admin sahifa va Telegram xabari shu yerdan oladi.
// ============================================================

const BRAND = {
  name: "Kiyim",                                   // logotip va sarlavhadagi nom
  city: "Toshkent",
  delivery: "Toshkent bo'ylab yetkazib berish 1 kunda",
  payment: "To'lov: yetkazib berilganda naqd yoki karta orqali",
  phone: "+998 99 001 49 44",                      // masalan "+998 90 123 45 67" (bo'sh bo'lsa ko'rsatilmaydi)
  telegram: "",                                    // masalan "kiyim_shop" (@ belgisiz)
  instagram: "",                                   // masalan "kiyim.uz"
  accent: "#ff2a1f",                               // asosiy rang (tugmalar, belgilar)
  photoCredit: "Suratlar: Unsplash, Pexels",       // o'z suratlaringiz bo'lsa — bo'sh qoldiring
};

// ---------- Sahifaga qo'llash (brauzerda) ----------
if (typeof document !== "undefined") {
  const b = BRAND;
  const apply = () => {
    document.documentElement.style.setProperty("--red", b.accent);
    document.title = document.title.replace(/^[^—]+—/, `${b.name} —`);
    document.querySelectorAll("[data-brand=name]").forEach((e) => (e.textContent = b.name));
    document.querySelectorAll("[data-brand=delivery]").forEach((e) => (e.textContent = `● ${b.delivery}`));
    document.querySelectorAll("[data-brand=payment]").forEach((e) => (e.textContent = b.payment));
    document.querySelectorAll("[data-brand=city]").forEach((e) => (e.placeholder = `${b.city}, ko'cha, uy`));
    const credit = document.querySelector("[data-brand=credit]");
    if (credit) credit.textContent = ["Kamera faqat brauzeringizda ishlaydi", b.photoCredit].filter(Boolean).join(" · ");
    const contacts = document.querySelector("[data-brand=contacts]");
    if (contacts) {
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const links = [
        b.phone && `<a href="tel:${esc(b.phone.replace(/[^\d+]/g, ""))}">${esc(b.phone)}</a>`,
        b.telegram && `<a href="https://t.me/${esc(b.telegram)}" target="_blank" rel="noopener">Telegram</a>`,
        b.instagram && `<a href="https://instagram.com/${esc(b.instagram)}" target="_blank" rel="noopener">Instagram</a>`,
      ].filter(Boolean);
      contacts.innerHTML = links.join(" · ");
      contacts.hidden = links.length === 0;
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
}

// Server (Node.js) ham nomni o'qiy olishi uchun (Telegram xabari)
if (typeof module !== "undefined") module.exports = { BRAND };
