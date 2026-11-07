// ============================================================
//  KIYIM — SERVER (Node.js, hech qanday kutubxona kerak emas)
//
//  Vazifalari:
//   1) public/ papkadagi saytni ko'rsatish
//   2) /api/tryon  — rasmingiz + kiyim rasmi → Gemini AI → kiyingan rasm
//   3) /api/order  — buyurtmani saqlash (+ Telegramga xabar)
//   4) /api/orders — admin uchun buyurtmalar ro'yxati
//
//  API kalitlar .env faylida turadi va hech qachon brauzerga yuborilmaydi.
//  Ishga tushirish:  node server.js
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------- .env faylini o'qish ----------
const ENV_FILE = path.join(__dirname, ".env");
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = +process.env.PORT || 3000;
let GEMINI_KEY = process.env.GEMINI_API_KEY || ""; // /api/setup orqali o'zgarishi mumkin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";

const PUBLIC = path.join(__dirname, "public");
// Mahsulotlar ro'yxati brauzer bilan bitta faylda — narxni server shu yerdan oladi,
// shuning uchun hech kim brauzerda narxni o'zgartirib arzon sotib ololmaydi.
const { PRODUCTS } = require("./public/js/products.js");
const DATA = path.join(__dirname, "data");
const ORDERS = path.join(DATA, "orders.json");
fs.mkdirSync(DATA, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8",
};

// ---------- Yordamchi funksiyalar ----------
function send(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Fayl juda katta")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("JSON noto'g'ri")); }
    });
  });
}

function serveStatic(req, res) {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.normalize(path.join(PUBLIC, url === "/" ? "index.html" : url));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "Taqiqlangan" }); // ../ hujumidan himoya
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "Topilmadi" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

// ============================================================
//  AI KIYIB KO'RISH (Google Gemini — "Nano Banana" rasm modeli)
// ============================================================
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
let modelCache = process.env.GEMINI_MODEL || "";

// Kalitingizga ochiq bo'lgan rasm-modelni avtomatik topamiz
async function pickModel() {
  if (modelCache) return modelCache;
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": GEMINI_KEY } });
  if (!r.ok) throw new Error(await geminiError(r));
  const { models = [] } = await r.json();
  const ok = models
    .filter((m) => /image/i.test(m.name) && m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace("models/", ""))
    .filter((n) => !/imagen|preview-tts/i.test(n));
  // Afzallik: flash (tez va arzon) → boshqalari
  ok.sort((a, b) => score(b) - score(a));
  if (!ok.length) throw new Error("Bu kalit uchun rasm yaratadigan Gemini modeli topilmadi");
  modelCache = ok[0];
  console.log("AI model tanlandi:", modelCache);
  return modelCache;
}
const score = (n) => (/flash/.test(n) ? 10 : 0) + (/lite/.test(n) ? -3 : 0) + (/preview/.test(n) ? -1 : 0) + (parseFloat(n.match(/\d+(\.\d+)?/)?.[0]) || 0);

async function geminiError(r) {
  const t = await r.text();
  try { return JSON.parse(t).error.message; } catch { return `${r.status} ${t.slice(0, 200)}`; }
}

const REGION = {
  top: "upper-body garment (replace whatever the person wears on the upper body)",
  dress: "dress (replace the person's current outfit with this dress)",
  pants: "trousers (replace whatever the person wears on the lower body)",
  shoes: "shoes (put them on the person's feet)",
  hat: "headwear (put it on the person's head)",
  glasses: "eyewear (put them on the person's face)",
  bag: "bag (the person is carrying it naturally)",
};

function buildPrompt(p) {
  return [
    "You are a professional virtual fitting room.",
    "IMAGE 1 is a photo of a real person. IMAGE 2 is a product photo of a clothing item.",
    `Create a photorealistic photo of the SAME person from IMAGE 1 wearing the ${REGION[p.type] || "item"} from IMAGE 2.`,
    `Product: "${p.name}".`,
    "Keep the person's face, identity, skin tone, hair, body shape, pose, camera angle, background and lighting exactly as in IMAGE 1.",
    "Copy the product's exact color, fabric texture, pattern, collar, buttons and details from IMAGE 2 and make it fit the body naturally with realistic folds and shadows.",
    "Ignore any hanger, hand, mannequin or model that holds the product in IMAGE 2.",
    "Do not add any text, watermark or extra people. Output only the final image.",
  ].join(" ");
}

function dataUrlParts(d) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(d || "");
  if (!m) throw new Error("Rasm formati noto'g'ri (PNG/JPEG kerak)");
  return { mime_type: m[1], data: m[2] };
}

// Bitta odam (IP) 10 daqiqada nechta AI so'rov yubora oladi — sayt internetda
// bo'lganda begonalar AI limitini (yoki pulingizni) sarflab yubormasligi uchun
const AI_LIMIT = +process.env.AI_LIMIT_PER_10MIN || 8;
const aiHits = new Map();
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}
function aiRateLimited(req) {
  const ip = clientIp(req), now = Date.now();
  const hits = (aiHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (hits.length >= AI_LIMIT) return true;
  hits.push(now);
  aiHits.set(ip, hits);
  return false;
}

async function handleTryOn(req, res) {
  if (aiRateLimited(req)) return send(res, 429, { error: "Juda ko'p so'rov. 10 daqiqadan keyin qayta urinib ko'ring." });
  const body = await readBody(req);
  const person = dataUrlParts(body.person);
  const product = PRODUCTS.find((p) => p.id === +body.productId);
  if (!product) return send(res, 400, { error: "Mahsulot topilmadi" });

  // Kiyim rasmini serverning o'zidan olamiz
  const garmentPath = path.join(PUBLIC, product.img);
  if (!fs.existsSync(garmentPath)) return send(res, 400, { error: "Mahsulot rasmi topilmadi" });

  // 1) Gemini kaliti bo'lsa — avval Gemini
  let geminiFail = null;
  if (GEMINI_KEY && Date.now() > geminiPausedUntil) {
    const g = await tryGemini(product, person, garmentPath);
    if (g.image) return send(res, 200, g);
    geminiFail = g;
    if (!g.fallback) return send(res, g.status, { error: g.error });
    console.log("Gemini ishlamadi, bepul modelga o'tamiz:", g.error);
  }

  // 2) Bepul modellar (Hugging Face)
  if (!FREE_MODELS[product.type]) {
    return send(res, 400, {
      error: geminiFail?.error ||
        "Bepul AI faqat kiyimlarni (kurtka, ko'ylak, futbolka, shim) kiydira oladi. Bu buyumni jonli rejimda kiyib ko'ring.",
    });
  }
  const f = await tryFree(product, Buffer.from(person.data, "base64"), garmentPath);
  if (f.image) return send(res, 200, f);
  send(res, f.status || 502, { error: f.error });
}

// ---------- Gemini ----------
let geminiPausedUntil = 0; // bepul tarif limiti chiqsa, vaqtincha to'g'ridan-to'g'ri bepul modelga o'tamiz

async function tryGemini(product, person, garmentPath) {
  const garment = {
    mime_type: garmentPath.endsWith(".png") ? "image/png" : "image/jpeg",
    data: fs.readFileSync(garmentPath).toString("base64"),
  };
  let model;
  try { model = await pickModel(); }
  catch (e) { return { status: 502, error: e.message, fallback: true }; }
  const started = Date.now();
  const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: buildPrompt(product) },
          { inline_data: person },
          { inline_data: garment },
        ],
      }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });
  if (!r.ok) {
    const msg = await geminiError(r);
    if (r.status === 404) modelCache = ""; // model nomi o'zgargan bo'lsa, qayta qidiramiz
    console.warn("Gemini xatosi:", r.status, msg.split("\n")[0]);
    if (r.status === 429) {
      const free = /free_tier/i.test(msg);
      if (free) geminiPausedUntil = Date.now() + 60 * 60 * 1000; // 1 soat Gemini'ni so'ramaymiz
      return {
        status: 429, fallback: true,
        error: free
          ? "Gemini bepul tarifda rasm chizmaydi (Billing kerak)."
          : "Gemini limiti vaqtincha tugadi.",
      };
    }
    return { status: 502, fallback: r.status >= 500, error: "Gemini xatosi: " + msg.split("\n")[0] };
  }
  const json = await r.json();
  const parts = json.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const why = parts.find((p) => p.text)?.text || json.candidates?.[0]?.finishReason || "noma'lum";
    return { status: 502, fallback: true, error: "Gemini rasm qaytarmadi: " + why };
  }
  const d = img.inlineData || img.inline_data;
  console.log(`AI tayyor (Gemini): ${product.name} — ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { image: `data:${d.mimeType || d.mime_type};base64,${d.data}`, model };
}

// ============================================================
//  BEPUL AI: Hugging Face'dagi ochiq modellar (Gradio API)
//   • IDM-VTON     — ustki kiyim uchun eng sifatlisi
//   • OOTDiffusion — ustki kiyim, shim va ko'ylak (dress)
//  Bepul, lekin kunlik limit bor. .env ga HF_TOKEN qo'shsangiz limit oshadi.
// ============================================================
const IDM = "https://yisol-idm-vton.hf.space";
const OOTD = "https://levihsu-ootdiffusion.hf.space/gradio_api";
let HF_TOKEN = process.env.HF_TOKEN || ""; // /sozlash.html orqali ham qo'shiladi

// Har bir kiyim turi uchun qaysi modellarni ketma-ket sinaymiz
const FREE_MODELS = {
  top:   [["idm"], ["ootd", "Upper-body"]],
  dress: [["ootd", "Dress"]],
  pants: [["ootd", "Lower-body"]],
};
const GARMENT_EN = { top: "upper-body garment, jacket or shirt", dress: "dress", pants: "trousers" };

const hfHeaders = () => (HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {});

// Rasmni Gradio serveriga yuklash → server ichidagi fayl yo'lini qaytaradi
async function gUpload(base, buf, name, mime) {
  const fd = new FormData();
  fd.append("files", new Blob([buf], { type: mime }), name);
  const r = await fetch(`${base}/upload`, { method: "POST", body: fd, headers: hfHeaders(), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`yuklash xatosi ${r.status}`);
  return { path: (await r.json())[0], meta: { _type: "gradio.FileData" } };
}

// Gradio funksiyasini chaqirish: avval navbatga qo'yamiz, keyin natijani kutamiz
async function gCall(base, api, data) {
  const r = await fetch(`${base}/call/${api}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hfHeaders() },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`navbat xatosi ${r.status}`);
  const { event_id } = await r.json();
  const s = await fetch(`${base}/call/${api}/${event_id}`, { headers: hfHeaders(), signal: AbortSignal.timeout(240000) });
  const text = await s.text();
  const done = text.match(/event: complete\s*data: (.*)/);
  if (done) return JSON.parse(done[1]);
  const err = text.match(/event: error\s*data: (.*)/);
  throw new Error(err ? err[1] : "javob kelmadi");
}

async function runFreeModel([name, category], product, personBuf, garmBuf, garmName) {
  if (name === "idm") {
    const [person, garm] = await Promise.all([
      gUpload(IDM, personBuf, "person.jpg", "image/jpeg"),
      gUpload(IDM, garmBuf, garmName, "image/jpeg"),
    ]);
    const out = await gCall(IDM, "tryon", [
      { background: person, layers: [], composite: null }, garm,
      GARMENT_EN[product.type], true, true, 30, 42,
    ]);
    return out[0].url;
  }
  const [person, garm] = await Promise.all([
    gUpload(OOTD, personBuf, "person.jpg", "image/jpeg"),
    gUpload(OOTD, garmBuf, garmName, "image/jpeg"),
  ]);
  const out = await gCall(OOTD, "process_dc", [person, garm, category, 1, 20, 2, -1]);
  const first = Array.isArray(out[0]) ? out[0][0] : out[0];
  return (first.image || first).url;
}

async function tryFree(product, personBuf, garmentPath) {
  const garmBuf = fs.readFileSync(garmentPath);
  const started = Date.now();
  let lastErr = "";
  for (const model of FREE_MODELS[product.type]) {
    try {
      const url = await runFreeModel(model, product, personBuf, garmBuf, path.basename(garmentPath));
      const img = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await img.arrayBuffer());
      const mime = url.endsWith(".webp") ? "image/webp" : url.endsWith(".jpg") ? "image/jpeg" : "image/png";
      const label = model[0] === "idm" ? "IDM-VTON" : "OOTDiffusion";
      console.log(`AI tayyor (${label}, bepul): ${product.name} — ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return { image: `data:${mime};base64,${buf.toString("base64")}`, model: label };
    } catch (e) {
      lastErr = String(e.message || e);
      console.warn(`Bepul model (${model[0]}) xatosi:`, lastErr.slice(0, 200));
    }
  }
  if (/quota|exceeded|GPU/i.test(lastErr))
    return { status: 429, error: "Bepul AI'ning limiti tugadi. Bir oz kutib qayta urinib ko'ring yoki .env ga HF_TOKEN qo'shing." };
  return { status: 502, error: "Bepul AI hozir band yoki ishlamayapti. Bir daqiqadan keyin qayta urinib ko'ring." };
}

// ============================================================
//  SOZLASH: kalitni brauzer orqali .env ga yozish
//  Faqat shu kompyuterning o'zidan (localhost) ishlaydi —
//  internetdagi hech kim kalitni o'zgartira olmaydi.
// ============================================================
function isLocal(req) {
  const ip = req.socket.remoteAddress || "";
  const host = (req.headers.host || "").split(":")[0];
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
  return loopback && ["localhost", "127.0.0.1"].includes(host) && !req.headers["x-forwarded-for"] && process.env.NODE_ENV !== "production";
}

async function handleSetup(req, res) {
  if (!isLocal(req)) return send(res, 403, { error: "Sozlash faqat shu kompyuterdan mumkin" });
  const { key, hfToken } = await readBody(req, 4096);

  // --- Hugging Face tokeni (bepul AI limitini oshiradi) ---
  if (hfToken !== undefined) {
    const t = String(hfToken || "").trim();
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) return send(res, 400, { error: "Bu Hugging Face tokeniga o'xshamaydi. U hf_ bilan boshlanadi." });
    const r = await fetch("https://huggingface.co/api/whoami-v2", { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) return send(res, 400, { error: "Hugging Face bu tokenni qabul qilmadi. Qaytadan nusxalab ko'ring." });
    const who = await r.json();
    writeEnv("HF_TOKEN", t);
    HF_TOKEN = t;
    console.log("Hugging Face tokeni ulandi ✅", who.name || "");
    return send(res, 200, { ok: true, user: who.name });
  }

  // --- Gemini kaliti ---
  const k = String(key || "").trim();
  if (!/^[A-Za-z0-9._\-]{20,200}$/.test(k)) return send(res, 400, { error: "Bu kalitga o'xshamaydi. AQ. yoki AIza bilan boshlanadigan uzun matnni joylang." });

  // Avval Google'dan so'raymiz: kalit haqiqiymi?
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": k } });
  if (!r.ok) return send(res, 400, { error: "Google bu kalitni qabul qilmadi: " + (await geminiError(r)).split("\n")[0] });

  writeEnv("GEMINI_API_KEY", k);
  GEMINI_KEY = k;
  modelCache = "";
  geminiPausedUntil = 0;
  console.log("Gemini kaliti yangilandi ✅");
  send(res, 200, { ok: true });
}

// .env faylidagi bitta qiymatni yangilash (bo'lmasa qo'shish)
function writeEnv(name, value) {
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${name}=${value}`) : env.replace(/\s*$/, `\n${name}=${value}\n`);
  fs.writeFileSync(ENV_FILE, env);
}

// ============================================================
//  BUYURTMALAR
// ============================================================
function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS, "utf8")); } catch { return []; }
}

async function handleOrder(req, res) {
  const b = await readBody(req, 100 * 1024);
  const name = String(b.name || "").trim().slice(0, 80);
  const phone = String(b.phone || "").replace(/[^\d+]/g, "").slice(0, 16);
  const address = String(b.address || "").trim().slice(0, 300);
  const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  if (name.length < 2) return send(res, 400, { error: "Ismingizni kiriting" });
  if (phone.replace(/\D/g, "").length < 9) return send(res, 400, { error: "Telefon raqam noto'g'ri" });
  if (!items.length) return send(res, 400, { error: "Savat bo'sh" });

  const orders = readOrders();
  const order = {
    id: 1000 + orders.length + 1,
    date: new Date().toISOString(),
    name, phone, address,
    items: items
      .map((i) => ({ p: PRODUCTS.find((p) => p.id === +i.id), qty: Math.min(99, Math.max(1, +i.qty | 0)) }))
      .filter((i) => i.p)
      .map(({ p, qty }) => ({ id: p.id, name: p.name, price: p.price, qty })),
    status: "yangi",
  };
  if (!order.items.length) return send(res, 400, { error: "Savatdagi mahsulotlar topilmadi" });
  order.total = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  orders.push(order);
  fs.writeFileSync(ORDERS, JSON.stringify(orders, null, 2));
  console.log(`Yangi buyurtma #${order.id}: ${name}, ${order.total} so'm`);
  notifyTelegram(order).catch((e) => console.warn("Telegram:", e.message));
  send(res, 200, { ok: true, id: order.id });
}

async function notifyTelegram(o) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const fmt = (n) => n.toLocaleString("ru-RU").replace(/,/g, " ") + " so'm";
  const text = [
    `🛍 Yangi buyurtma #${o.id}`,
    `👤 ${o.name}`, `📞 ${o.phone}`, o.address && `📍 ${o.address}`, "",
    ...o.items.map((i) => `• ${i.name} × ${i.qty} — ${fmt(i.price * i.qty)}`),
    "", `💰 Jami: ${fmt(o.total)}`,
  ].filter((x) => x !== undefined && x !== "").join("\n");
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
}

function handleOrders(req, res) {
  if (!ADMIN_PASSWORD) return send(res, 503, { error: ".env faylga ADMIN_PASSWORD yozing" });
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return send(res, 401, { error: "Parol noto'g'ri" });
  send(res, 200, readOrders().reverse());
}

// ============================================================
//  MARSHRUTLAR (qaysi manzil qaysi funksiyaga boradi)
// ============================================================
http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (url === "/api/config") return send(res, 200, { ai: true, gemini: !!GEMINI_KEY, hf: !!HF_TOKEN, freeTypes: Object.keys(FREE_MODELS) });
    if (url === "/api/tryon" && req.method === "POST") return await handleTryOn(req, res);
    if (url === "/api/order" && req.method === "POST") return await handleOrder(req, res);
    if (url === "/api/setup" && req.method === "POST") return await handleSetup(req, res);
    if (url === "/api/orders") return handleOrders(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    send(res, 405, { error: "Ruxsat yo'q" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`\n  Kiyim ishga tushdi →  http://localhost:${PORT}`);
  console.log(`  AI kiyib ko'rish: ${GEMINI_KEY ? "✅ Gemini (+ bepul zaxira)" : "✅ bepul modellar (IDM-VTON, OOTDiffusion)"}`);
  console.log(`  Telegram xabar:   ${TG_TOKEN && TG_CHAT ? "✅ ulangan" : "— ulanmagan (ixtiyoriy)"}\n`);
});
