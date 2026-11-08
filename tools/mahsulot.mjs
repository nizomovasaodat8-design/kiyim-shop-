// ============================================================
//  YANGI MAHSULOT QO'SHISH VOSITASI (faqat kompyuterda ishlatiladi)
//
//  Bitta buyruq bilan:
//   1) suratni public/img/products/ ga saqlaydi (900px gacha kichraytiradi)
//   2) fonni olib tashlaydi (imgly) va surat model kiygan bo'lsa — faqat kiyimni
//      ajratadi (segformer: yuz, qo'l, oyoq, sochni olib tashlaydi)
//   3) qo'l o'rnida qolgan kichik teshiklarni mato rangi bilan to'ldiradi
//   4) foni olingan kiyimni public/img/cutout/ ga saqlaydi
//   5) products.js ga yangi mahsulot qatorini qo'shadi (jonli rejim yoqilgan)
//  Kiyimni tanaga moslash (fit) keyin brauzerning o'zida avtomatik hisoblanadi.
//
//  O'rnatish (bir marta):   cd tools  →  npm install
//  Ishlatish:
//    node tools/mahsulot.mjs <surat.jpg yoki https://...> --nom "Qora palto" --narx 1990000 --tur top --bolim qish
//  Qo'shimcha:  --yangi     (YANGI yorlig'i)
//               --odamsiz   (surat odamsiz: kiyim stolda/ilgichda — butun buyum olinadi)
//               --chegirma  (−20% yorlig'i)
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTS_JS = path.join(ROOT, "public/js/products.js");
const require = createRequire(import.meta.url);

// ---------- Buyruq qatori ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const VALUE_OPTS = ["--nom", "--narx", "--tur", "--bolim"];
const src = argv.find((a, i) => !a.startsWith("--") && !VALUE_OPTS.includes(argv[i - 1]));

const TYPES = ["top", "dress", "pants", "shoes", "hat", "glasses", "bag"];
const { CATEGORIES, PRODUCTS } = require(PRODUCTS_JS);
const fail = (m) => { console.error("\n✖ " + m + "\n"); process.exit(1); };

if (!src || flag("help")) {
  console.log(`
Ishlatish:
  node tools/mahsulot.mjs <surat yoki URL> --nom "Nomi" --narx 990000 --tur <tur> --bolim <bo'lim> [--yangi] [--odamsiz] [--chegirma]

  --tur    ${TYPES.join(" | ")}
           (top — kurtka, palto, sviter, ko'ylak-shirt; dress — ayollar ko'ylagi)
  --bolim  ${CATEGORIES.filter((c) => c.id !== "all").map((c) => c.id).join(" | ")}
`);
  process.exit(src ? 0 : 1);
}
const name = opt("nom"), price = +opt("narx"), type = opt("tur"), cat = opt("bolim");
if (!name) fail('--nom kerak, masalan --nom "Qora palto"');
if (!(price > 0)) fail("--narx kerak, so'mda, masalan --narx 1990000");
if (!TYPES.includes(type)) fail(`--tur shulardan biri bo'lsin: ${TYPES.join(", ")}`);
if (!CATEGORIES.some((c) => c.id === cat && c.id !== "all"))
  fail(`--bolim shulardan biri bo'lsin: ${CATEGORIES.filter((c) => c.id !== "all").map((c) => c.id).join(", ")}`);
const flat = flag("odamsiz") || !["top", "dress", "pants", "shoes", "hat"].includes(type);

// ---------- Kutubxonalar (tools/node_modules) ----------
let RawImage, pipeline;
try {
  ({ RawImage, pipeline } = await import("@huggingface/transformers"));
  await import.meta.resolve("@imgly/background-removal-node");
} catch {
  fail("Kutubxonalar o'rnatilmagan. Avval bir marta:  cd tools  →  npm install");
}

// ---------- 1) Asl suratni saqlash ----------
const slug = "m" + Date.now().toString(36);
const photoRel = `img/products/${slug}.jpg`;
const cutRel = `img/cutout/${slug}.webp`;

console.log("1/5  Surat o'qilmoqda…");
let photo;
if (/^https?:\/\//.test(src)) {
  const r = await fetch(src);
  if (!r.ok) fail(`Suratni yuklab bo'lmadi (${r.status})`);
  photo = await RawImage.fromBlob(await r.blob());
} else {
  if (!fs.existsSync(src)) fail(`Fayl topilmadi: ${src}`);
  photo = await RawImage.read(path.resolve(src));
}
photo = photo.rgb();
if (photo.width > 900) photo = await photo.resize(900, Math.round((photo.height * 900) / photo.width));
await photo.save(path.join(ROOT, "public", photoRel));
const W = photo.width, H = photo.height, N = W * H;

// ---------- 2) Fonni olib tashlash ----------
console.log("2/5  Fon olib tashlanmoqda…");
const tmpPng = path.join(os.tmpdir(), `${slug}-fon.png`);
execFileSync(process.execPath, [path.join(ROOT, "tools/_fon.mjs"), path.join(ROOT, "public", photoRel), tmpPng], { stdio: ["ignore", "ignore", "inherit"] });
const cut = (await RawImage.read(tmpPng)).rgba();
fs.rmSync(tmpPng, { force: true });
const alpha = new Uint8ClampedArray(N);
for (let i = 0; i < N; i++) alpha[i] = cut.data[i * 4 + 3];

// ---------- 3) Faqat kiyimni ajratish ----------
const WANT = {
  top:   ["Upper-clothes", "Dress", "Scarf", "Belt"],
  dress: ["Dress", "Upper-clothes", "Skirt", "Belt"],
  pants: ["Pants", "Skirt", "Belt"],
  shoes: ["Left-shoe", "Right-shoe"],
  hat:   ["Hat"],
};
if (!flat) {
  console.log("3/5  Kiyim ajratilmoqda (birinchi marta model yuklanadi, ~1 daqiqa)…");
  const seg = await pipeline("image-segmentation", "Xenova/segformer_b2_clothes", { dtype: "fp32" });
  const res = await seg(photo);
  const mask = new Uint8ClampedArray(N);
  let found = false;
  for (const r of res) {
    if (!WANT[type].includes(r.label)) continue;
    found = true;
    let m = r.mask;
    if (m.width !== W || m.height !== H) m = await m.resize(W, H);
    for (let i = 0; i < N; i++) if (m.data[i] > mask[i]) mask[i] = m.data[i];
  }
  if (!found) fail(`Suratda "${type}" turidagi kiyim topilmadi. Surat odamsiz bo'lsa, --odamsiz qo'shing.`);
  const soft = blur(dilate(mask, W, H, 2), W, H, 2);
  // imgly qorong'i fonda kiyimni yarim shaffof qoldirishi mumkin — kiyim niqobi ichida uni kuchaytiramiz
  for (let i = 0; i < N; i++) alpha[i] = (Math.min(255, alpha[i] * 3) * soft[i]) / 255;
  fillHoles(cut.data, alpha, W, H);
  dropIslands(alpha, W, H);
} else {
  console.log("3/5  Surat odamsiz — butun buyum olinadi");
}

// ---------- 4) Kesish va saqlash ----------
console.log("4/5  Saqlanmoqda…");
let l = W, t = H, r = -1, b = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (alpha[i] < 20) { alpha[i] = 0; continue; }
  if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
}
if (r < 0) fail("Suratda buyum topilmadi.");
for (let i = 0; i < N; i++) cut.data[i * 4 + 3] = alpha[i];
let out = await cut.crop([l, t, r, b]);
const sc = Math.min(1, 700 / Math.max(out.width, out.height));
if (sc < 1) out = await out.resize(Math.round(out.width * sc), Math.round(out.height * sc));
await out.save(path.join(ROOT, "public", cutRel));

// ---------- 5) products.js ga qo'shish ----------
const id = Math.max(...PRODUCTS.map((p) => p.id)) + 1;
const f3 = (v) => +v.toFixed(3);
const box = flat ? "" : `, box: [${f3(l / W)}, ${f3(t / H)}, ${f3((r + 1) / W)}, ${f3((b + 1) / H)}]`;
const extra = (flag("yangi") ? ", isNew: true" : "") + (flag("chegirma") ? ", sale: true" : "");
const line = `  P(${id}, "${slug}", { cat: "${cat}", type: "${type}", live: true, name: ${JSON.stringify(name)}, price: ${Math.round(price)}${extra}${box} }),`;
let text = fs.readFileSync(PRODUCTS_JS, "utf8");
const start = text.indexOf("const PRODUCTS = [");
const end = text.indexOf("\n];", start);
if (start < 0 || end < 0) fail("products.js ichida PRODUCTS ro'yxati topilmadi.");
text = text.slice(0, end) + "\n" + line + text.slice(end);
fs.writeFileSync(PRODUCTS_JS, text);

console.log(`5/5  Tayyor ✅  #${id} "${name}" qo'shildi.
     Surat:   public/${photoRel}
     Kiyim:   public/${cutRel}
     Saytda tekshiring (node server.js → http://localhost:3000), keyin GitHub'ga yuklang.`);

// ============================================================
//  Yordamchi tasvir funksiyalari (1 kanalli niqoblar uchun)
// ============================================================
function dilate(src, w, h, rad) {
  const tmp = new Uint8ClampedArray(src.length), dst = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < w && src[y * w + xx] > m) m = src[y * w + xx]; }
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x] > m) m = tmp[yy * w + x]; }
    dst[y * w + x] = m;
  }
  return dst;
}

function blur(src, w, h, rad) {
  const tmp = new Float32Array(src.length), dst = new Uint8ClampedArray(src.length), n = rad * 2 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
    dst[y * w + x] = s / n;
  }
  return dst;
}

// Asosiy kiyimdan uzilib qolgan mayda bo'laklarni (soch uchlari, fon dog'lari) o'chiradi
function dropIslands(alpha, w, h) {
  const n = w * h, lab = new Int32Array(n), sizes = [0];
  for (let s = 0; s < n; s++) {
    if (alpha[s] < 40 || lab[s]) continue;
    const id = sizes.length, comp = [s]; lab[s] = id;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w])
        if (j !== false && !lab[j] && alpha[j] >= 40) { lab[j] = id; comp.push(j); }
    }
    sizes.push(comp.length);
  }
  const biggest = Math.max(0, ...sizes);
  for (let i = 0; i < n; i++) {
    // yarim shaffof chet piksellar eng yaqin bo'lak bilan qoladi; kichik bo'laklar o'chadi
    if (lab[i] && sizes[lab[i]] < 0.03 * biggest) alpha[i] = 0;
  }
}

// Kiyim ichidagi kichik teshiklar (kaft, barmoqlar) — atrofdagi rang bilan to'ldiriladi.
// Katta teshiklar (masalan, kapyushon ichidagi yuz) o'z holicha qoladi.
function fillHoles(rgba, alpha, w, h) {
  const n = w * h, solid = new Uint8Array(n), outside = new Uint8Array(n);
  let area = 0;
  for (let i = 0; i < n; i++) if (alpha[i] > 127) { solid[i] = 1; area++; }
  const stack = [];
  const push = (i) => { if (!solid[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  // teshiklarni guruhlarga ajratib, kichiklarini belgilaymiz
  const seen = new Uint8Array(n), fill = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (solid[s] || outside[s] || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w])
        if (j !== false && !solid[j] && !outside[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
    }
    if (comp.length < 0.05 * area) for (const i of comp) fill[i] = 1;
  }
  // rangni chetdan ichkariga qarab "yoyamiz"
  let todo = [];
  for (let i = 0; i < n; i++) if (fill[i]) todo.push(i);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) known[i] = solid[i];
  while (todo.length) {
    const next = [], done = [];
    for (const i of todo) {
      const x = i % w, y = (i / w) | 0;
      let r = 0, g = 0, b = 0, c = 0;
      for (const j of [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w])
        if (j !== false && known[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; c++; }
      if (c) { rgba[i * 4] = r / c; rgba[i * 4 + 1] = g / c; rgba[i * 4 + 2] = b / c; done.push(i); }
      else next.push(i);
    }
    if (!done.length) break;
    for (const i of done) { known[i] = 1; alpha[i] = 255; }
    todo = next;
  }
}
