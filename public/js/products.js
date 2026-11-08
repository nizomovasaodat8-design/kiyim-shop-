// ============================================================
//  MAHSULOTLAR BAZASI
//  Bu fayl ham brauzerda, ham serverda (server.js) ishlatiladi.
//  Narxni o'zgartirsangiz — sayt ham, buyurtma summasi ham o'zgaradi.
//
//  Maydonlar:
//   img  — katalogdagi surat
//   cut  — foni olib tashlangan surat (jonli rejim uchun)
//   type — qayerga kiyiladi: top | dress | pants | shoes | hat | glasses | bag
//   live — jonli rejimda tanaga yopishtirsa bo'ladimi
//          (modelda kiyilgan suratlar uchun false — ular faqat AI rejimda)
//   fit  — jonli rejimda kiyimni tanaga moslash (ixtiyoriy). Model kiygan suratlar uchun
//          avtomatik hisoblangan: y/x — yelka (shim: bel) nuqtasi, y2/x2 — son (shim: to'piq)
//          nuqtasi, w — kenglik / yelka oralig'i, a — suratdagi yelka qiyaligi
// ============================================================

const CATEGORIES = [
  { id: "all",       name: "Hammasi" },
  { id: "qish",      name: "❄ Qish kolleksiyasi" },
  { id: "ustki",     name: "Ustki kiyim" },
  { id: "koylak",    name: "Ko'ylaklar" },
  { id: "jinsi",     name: "Shimlar" },
  { id: "poyabzal",  name: "Poyabzal" },
  { id: "bosh",      name: "Bosh kiyim" },
  { id: "kozoynak",  name: "Ko'zoynak" },
  { id: "aksessuar", name: "Sumkalar" },
];

// Qisqa yozish uchun yordamchi: rasm nomidan ikkala yo'lni yasaydi
const P = (id, photo, data) => ({
  id,
  img: `img/products/${photo}.jpg`,
  cut: `img/cutout/${photo}.webp`,
  ...data,
});

const PRODUCTS = [
  // ---- ❄ Qish kolleksiyasi (premium) ----
  // Suratlar: Pexels (bepul litsenziya). Cutout'larda faqat kiyimning o'zi qoldirilgan (yuz/qo'l/fonsiz).
  P(29, "px-36018377", { cat: "qish", type: "top",   live: true , name: "Qora mat puffer kurtka",          price: 2390000, isNew: true, fit: {w: 1.857, y: 0.234, y2: 0.852, x: 0.475, x2: 0.446, a: 0.009} }),
  P(30, "px-14991031", { cat: "qish", type: "top",   live: false, name: "Krem qisqa puffer",               price: 2290000, isNew: true }),
  P(31, "px-6764036",  { cat: "qish", type: "top",   live: false, name: "Ko'k gradient oversize puffer",   price: 2150000 }),
  P(32, "px-21567458", { cat: "qish", type: "top",   live: true , name: "Havorang puffer kurtka",          price: 1990000, fit: {w: 1.805, y: 0.224, y2: 0.933, x: 0.485, x2: 0.52, a: -0.07} }),
  P(33, "px-28969183", { cat: "qish", type: "top",   live: true , name: "Bej teddy palto",                 price: 2790000, isNew: true, fit: {w: 1.741, y: 0.216, y2: 0.838, x: 0.497, x2: 0.491, a: 0.056} }),
  P(34, "px-8360771",  { cat: "qish", type: "top",   live: true , name: "Uzun qora jun palto",             price: 3490000, isNew: true, fit: {w: 1.893, y: 0.104, y2: 0.481, x: 0.515, x2: 0.494, a: -0.005} }),
  P(35, "px-35140368", { cat: "qish", type: "top",   live: true , name: "Qora klassik palto",              price: 2990000, fit: {w: 1.701, y: 0.43, y2: 0.891, x: 0.475, x2: 0.443, a: -0.047} }),
  P(36, "px-14707853", { cat: "qish", type: "top",   live: true , name: "Qo'y junli aviator kurtka",       price: 3690000, isNew: true, fit: {w: 1.734, y: 0.193, y2: 0.916, x: 0.441, x2: 0.368, a: -0.047} }),
  P(37, "px-3265546",  { cat: "qish", type: "top",   live: true , name: "Qora oversize gorlo sviter",      price: 890000, fit: {w: 1.713, y: 0.325, y2: 1.225, x: 0.476, x2: 0.444, a: 0.031} }),
  P(38, "px-29047225", { cat: "qish", type: "dress", live: true , name: "Qizil-qora trikotaj ko'ylak",     price: 1190000, fit: {w: 1.881, y: 0.078, y2: 0.632, x: 0.537, x2: 0.441, a: 0.27} }),
  P(39, "px-26851193", { cat: "qish", type: "shoes", live: true , name: "Jigarrang charm botilon",         price: 1890000 }),
  P(40, "px-26851201", { cat: "qish", type: "shoes", live: true , name: "Qora tasmali botilon",            price: 1890000 }),
  P(41, "px-27598915", { cat: "qish", type: "shoes", live: false, name: "Qora baland charm etik",          price: 2490000, isNew: true }),
  P(42, "px-18310498", { cat: "qish", type: "hat",   live: true , name: "Qora beanie shapka",              price: 290000, fit: {w: 1.719, y: 0.625, x: 0.614, a: -0.092} }),

  // ---- Ustki kiyim ----
  P(1,  "1611312449408-fcece27cdbb7", { cat: "ustki",  type: "top",   live: true,  name: "Velvet yoqali jinsi kurtka", price: 1676000, isNew: true, fit: { w: 1.6, y: 0.2 } }),
  P(2,  "1591047139829-d91aecb6caea", { cat: "ustki",  type: "top",   live: true,  name: "Terrakota bomber",          price: 1880000, fit: { w: 1.65, y: 0.22 } }),
  P(3,  "1551028719-00167b16eac5",    { cat: "ustki",  type: "top",   live: false, name: "Qora charm kurtka",         price: 3150000 }),
  P(4,  "1620799140408-edc6dcb6d633", { cat: "ustki",  type: "top",   live: true , name: "Oq svitshot",               price: 590000 }),

  // ---- Ko'ylaklar va futbolkalar ----
  P(5,  "1596755094514-f87e34085b2c", { cat: "koylak", type: "top",   live: true,  name: "No'xatli jinsi ko'ylak",    price: 649000, fit: { w: 1.9, y: 0.19 } }),
  P(6,  "1603252109303-2751441dd157", { cat: "koylak", type: "top",   live: false, name: "Oq poplin ko'ylak",         price: 549000 }),
  P(7,  "1618354691373-d851c5c3a990", { cat: "koylak", type: "top",   live: true,  name: "Qora futbolka “705”",       price: 249000, fit: { w: 1.9, y: 0.21 } }),
  P(8,  "1564584217132-2271feaeb3c5", { cat: "koylak", type: "top",   live: true,  name: "Havorang futbolka",         price: 229000, fit: { w: 1.9, y: 0.22 } }),
  P(9,  "1521572163474-6864f9cf17ab", { cat: "koylak", type: "top",   live: true , name: "Oq paxta futbolka",         price: 199000, fit: {w: 1.517, y: 0.156, y2: 0.941, x: 0.495, x2: 0.474, a: -0.024} }),
  P(10, "1572804013309-59a88b7e92f1", { cat: "koylak", type: "dress", live: true , name: "Qizil gulli ko'ylak",       price: 899000, isNew: true, fit: {w: 2.581, y: 0.055, y2: 0.453, x: 0.541, x2: 0.529, a: -0.063} }),
  P(11, "1591369822096-ffd140ec948f", { cat: "koylak", type: "dress", live: false, name: "Jinsi ko'ylak",             price: 1099000 }),
  P(12, "1515372039744-b8f02a3ae446", { cat: "koylak", type: "dress", live: true , name: "Oq yozgi ko'ylak",          price: 1240000, fit: {w: 1.536, y: -0.016, y2: 0.663, x: 0.517, x2: 0.505, a: 0.061} }),
  P(13, "1585487000160-6ebcfceb0d03", { cat: "koylak", type: "dress", live: true , name: "Bordo velvet ko'ylak",      price: 1190000, fit: {w: 2.047, y: 0.075, y2: 0.46, x: 0.34, x2: 0.453, a: -0.05} }),

  // ---- Shimlar ----
  P(14, "1624378439575-d8705ad7ae80", { cat: "jinsi",  type: "pants", live: true,  name: "To'q ko'k to'g'ri jinsi",   price: 749000 }),
  P(15, "1584370848010-d7fe6bc767ec", { cat: "jinsi",  type: "pants", live: true , name: "Och ko'k skinny jinsi",     price: 699000, fit: {w: 2.169, y: 0.02, y2: 0.95, x: 0.452, x2: 0.5} }),
  P(16, "1594633312681-425c7b97ccd1", { cat: "jinsi",  type: "pants", live: true , name: "Pushti jogger shim",        price: 459000, sale: true, fit: {w: 3.709, y: 0.02, y2: 0.95, x: 0.422, x2: 0.5} }),

  // ---- Poyabzal ----
  P(17, "1608256246200-53e635b5b65f", { cat: "poyabzal", type: "shoes", live: true,  name: "Charm botinka",           price: 1450000 }),
  P(18, "1560769629-975ec94e6a86",    { cat: "poyabzal", type: "shoes", live: false, name: "Rangli krossovka",        price: 990000 }),
  P(19, "1543163521-1bf539c55dd2",    { cat: "poyabzal", type: "shoes", live: false, name: "Gulli tufli",             price: 790000 }),

  // ---- Bosh kiyim ----
  P(20, "1588850561407-ed78c282e89b", { cat: "bosh", type: "hat", live: true,  name: "Oq trucker kepka",     price: 189000 }),
  P(21, "1521369909029-2afed882baee", { cat: "bosh", type: "hat", live: true,  name: "Kulrang kepka",        price: 219000 }),
  P(22, "1514327605112-b887c0e61c0a", { cat: "bosh", type: "hat", live: true , name: "Fetr shlyapa",         price: 459000, fit: {w: 2.881, y: 0.808, x: 0.511, a: 0.012} }),
  P(23, "1576871337632-b9aef4c17ab9", { cat: "bosh", type: "hat", live: false, name: "Trikotaj shapka",      price: 149000 }),

  // ---- Ko'zoynak ----
  P(24, "1511499767150-a48a237f0083", { cat: "kozoynak", type: "glasses", live: true, name: "Tilla ramkali ko'zoynak",   price: 529000 }),
  P(25, "1577803645773-f96470509666", { cat: "kozoynak", type: "glasses", live: true, name: "Shaffof quyosh ko'zoynagi", price: 389000 }),

  // ---- Sumkalar ----
  P(26, "1590874103328-eac38a683ce7", { cat: "aksessuar", type: "bag", live: true, name: "To'qima savat-sumka", price: 690000 }),
  P(27, "1584917865442-de89df76afd3", { cat: "aksessuar", type: "bag", live: true, name: "Qizil charm sumka",   price: 1290000 }),
  P(28, "1553062407-98eeb64c6a62",    { cat: "aksessuar", type: "bag", live: true, name: "Shahar ryukzagi",     price: 560000 }),
];

// 1676000 → "1 676 000 so'm"
function formatPrice(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
}

// Server (Node.js) ham shu ro'yxatni o'qiy olishi uchun
if (typeof module !== "undefined") module.exports = { CATEGORIES, PRODUCTS, formatPrice };
