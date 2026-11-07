// ============================================================
//  KIYINISH XONASI — ikki rejim:
//
//  1) JONLI rejim (bepul, darhol):
//     kamera → MediaPipe Pose tanadagi nuqtalarni topadi →
//     kiyimning foni olib tashlangan surati tanaga moslab "egiladi"
//     (yelka → bel, bel → to'piq). Bir nechta buyumni birga kiyish mumkin (to'plam).
//
//  2) AI rejim (haqiqiy ko'rinish):
//     3-2-1 sanoq → tana kadrda to'liq ko'rinsa, bitta kadr olinadi →
//     serverga (/api/tryon) yuboriladi → Gemini "shu odam shu kiyimda" rasmini qaytaradi.
//     Natija "oldin / keyin" slayderi bilan ko'rsatiladi va solishtirish uchun saqlanadi.
//
//  3) O'lcham tavsiyasi:
//     bo'y (sm) + MediaPipe'ning metrdagi 3D nuqtalari → yelka kengligi → S/M/L…
// ============================================================

const $ = (s) => document.querySelector(s);
const video = $("#video");
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");

const MP_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Har bir kiyim turi qanday o'lchanadi:
//  w — kiyim kengligi = tana o'lchovi × w
//  y — rasmning qaysi qismi (yuqoridan, 0..1) tanadagi nuqtaga to'g'ri keladi
const FIT = {
  top:     { w: 1.75, y: 0.2 },   // yelkalarga
  dress:   { w: 1.9,  y: 0.1 },
  pants:   { w: 2.3,  y: 0.02 },  // belga
  hat:     { w: 1.45, y: 0.78 },  // boshga
  glasses: { w: 1.45, y: 0.5 },   // ko'zlarga
  bag:     { w: 0.75, y: 0.0 },
  shoes:   { w: 1.6,  y: 0.55 },
};

// To'plam: har bir "joy"da bitta buyum. Ko'ylak (dress) ham ustki, ham pastki joyni egallaydi.
const SLOT = { top: "top", dress: "top", pants: "pants", shoes: "shoes", hat: "hat", glasses: "glasses", bag: "bag" };
const DRAW_ORDER = ["pants", "shoes", "top", "bag", "glasses", "hat"]; // pastdan yuqoriga chiziladi

// AI surati olinishidan oldin kadrda ko'rinishi kerak bo'lgan tana nuqtalari
const NEED = {
  top:     { ids: [0, 11, 12],                  msg: "Yuzingiz va yelkalaringiz ko'rinsin" },
  bag:     { ids: [11, 12],                     msg: "Yelkalaringiz ko'rinsin" },
  dress:   { ids: [11, 12, 23, 24, 25, 26],     msg: "Tizzangizgacha ko'rining — biroz orqaga turing" },
  pants:   { ids: [23, 24, 25, 26, 27, 28],     msg: "Oyog'ingizgacha ko'rining — 2–3 qadam orqaga turing" },
  shoes:   { ids: [27, 28],                     msg: "Oyoqlaringiz ko'rinsin — 2–3 qadam orqaga turing" },
  hat:     { ids: [0, 7, 8],                    msg: "Yuzingiz kadrga to'liq tushsin" },
  glasses: { ids: [0, 2, 5],                    msg: "Yuzingiz kadrga to'liq tushsin" },
};

let stream = null, pose = null, current = null;
let smooth = null, lastWorld = null, running = false, showGuide = true, aiEnabled = false;
let lastTime = -1;
const outfit = {};          // joy → mahsulot
const imgCache = {};        // mahsulot id → foni olingan rasm

// Server AI ulanganmi? (.env da kalit bormi)
fetch("/api/config").then((r) => r.json()).then((c) => (aiEnabled = c.ai)).catch(() => {});

// ---------- OCHISH / YOPISH ----------
window.openTryOn = async (productId) => {
  $("#tryon").classList.add("is-open");
  document.body.style.overflow = "hidden";
  hideResult();
  select(productId);
  renderMini();
  if (!stream && (await startCamera())) loadPose();
};

function closeTryOn() {
  $("#tryon").classList.remove("is-open");
  document.body.style.overflow = "";
  stopCountdown();
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// ---------- KAMERA ----------
async function startCamera() {
  setStatus("Kamera ishga tushmoqda…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    setStatus("Tana modelini yuklayapmiz…");
    requestAnimationFrame(loop);
    return true;
  } catch (err) {
    console.error(err);
    setStatus("Kamera ochilmadi. Ruxsat bering yoki pastdagi “Rasm yuklash” orqali AI rejimdan foydalaning.");
    return false;
  }
}

async function loadPose() {
  if (pose) return setStatus("");
  try {
    const { PoseLandmarker, FilesetResolver } = await import(`${MP_URL}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    pose = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    setStatus("");
  } catch (err) {
    console.warn("Pose modeli yuklanmadi", err);
    setStatus("Tana modeli yuklanmadi (internetni tekshiring). AI rejim baribir ishlaydi.");
  }
}

// ---------- ASOSIY SIKL ----------
function loop() {
  if (!running) return;
  fitCanvas();
  const view = drawVideo();

  if (pose && video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    const res = pose.detectForVideo(video, performance.now());
    const lm = res.landmarks?.[0];
    smooth = lm ? smoothLandmarks(smooth, lm) : null;
    lastWorld = res.worldLandmarks?.[0] || null;
  }

  const found = !!smooth && visible(smooth[11]) && visible(smooth[12]);
  const wearing = Object.keys(outfit).length > 0;
  $("#guide").classList.toggle("is-hidden", !showGuide || found);
  $("#hint").textContent = current.live ? "Chiziqlar ichiga turing" : "Bu buyum AI rejimda kiyiladi ↓";
  $("#hint").classList.toggle("is-hidden", current.live ? found || !showGuide : false);
  $("#badge").textContent = found ? "✦ Jonli rejim · tana topildi" : "✦ Jonli rejim";

  if (found && wearing) {
    for (const slot of DRAW_ORDER) {
      const p = outfit[slot];
      const img = p && garment(p);
      if (img?.complete && img.naturalWidth) drawOnBody(smooth, view, p, img);
    }
  }
  requestAnimationFrame(loop);
}

function fitCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function drawVideo() {
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(cw / vw, ch / vh);
  const dx = (cw - vw * s) / 2, dy = (ch - vh * s) / 2;
  ctx.save();
  ctx.translate(cw, 0);
  ctx.scale(-1, 1); // ko'zgu effekti
  ctx.drawImage(video, dx, dy, vw * s, vh * s);
  ctx.restore();
  return { cw, vw, vh, s, dx, dy };
}

const toPx = (p, v) => ({ x: v.cw - (v.dx + p.x * v.vw * v.s), y: v.dy + p.y * v.vh * v.s });
const visible = (p) => p && (p.visibility ?? 1) > 0.5;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const level = (a, b) => { // ikki nuqta orasidagi qiyalik (doim -90°..90°)
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.abs(ang) > Math.PI / 2) ang -= Math.PI * Math.sign(ang);
  return ang;
};

function smoothLandmarks(prev, next, k = 0.55) {
  if (!prev) return next.map((p) => ({ ...p }));
  return next.map((p, i) => ({
    x: prev[i].x * k + p.x * (1 - k),
    y: prev[i].y * k + p.y * (1 - k),
    visibility: p.visibility,
  }));
}

function garment(p) {
  let img = imgCache[p.id];
  if (!img) { img = new Image(); img.src = p.cut; imgCache[p.id] = img; }
  return img;
}

// ---------- KIYIMNI TANAGA JOYLASH ----------
function drawOnBody(lm, v, p, img) {
  const P = (i) => toPx(lm[i], v);
  const f = { ...FIT[p.type], ...p.fit };
  const ls = P(11), rs = P(12);
  const sw = dist(ls, rs), sMid = mid(ls, rs);
  const hipsOk = visible(lm[23]) && visible(lm[24]);
  const hw = hipsOk ? dist(P(23), P(24)) : sw * 0.72;
  const hMid = hipsOk ? mid(P(23), P(24)) : { x: sMid.x, y: sMid.y + sw * 1.3 };
  const hA = hipsOk ? level(P(23), P(24)) : level(ls, rs);

  switch (p.type) {
    case "top":
    case "dress":
      return warpTorso(img, f, { sMid, hMid, sw, hw, sA: level(ls, rs), hA });
    case "pants": {
      const waist = { x: hMid.x, y: hMid.y - hw * 0.15 };
      const anklesOk = visible(lm[27]) && visible(lm[28]);
      const kneesOk = visible(lm[25]) && visible(lm[26]);
      if (!hipsOk || !(anklesOk || kneesOk)) return place(img, waist, hw * f.w, f.y, hA);
      const end = anklesOk ? mid(P(27), P(28)) : mid(P(25), P(26));
      return warpLegs(img, f, { waist, end, endFrac: anklesOk ? 1 : 0.55, hw, hA });
    }
    case "hat": {
      const le = P(7), re = P(8), head = dist(le, re), eyes = mid(P(2), P(5));
      return place(img, { x: eyes.x, y: eyes.y - head * 0.3 }, head * f.w, f.y, level(le, re));
    }
    case "glasses": {
      const lo = P(3), ro = P(6);
      return place(img, mid(lo, ro), dist(lo, ro) * f.w, f.y, level(lo, ro));
    }
    case "bag": {
      const side = ls.x > rs.x ? ls : rs;
      return place(img, { x: side.x + sw * 0.2, y: side.y + sw * 0.5 }, sw * f.w, f.y, 0);
    }
    case "shoes": {
      if (!(visible(lm[27]) && visible(lm[28]))) return;
      return place(img, mid(P(27), P(28)), hw * f.w, f.y, 0);
    }
  }
}

// Rasmni tabiiy nisbatida (cho'zmasdan) joylash — shapka, ko'zoynak, sumka, poyabzal uchun
function place(img, anchor, w, anchorY, angle) {
  const h = w * (img.naturalHeight / img.naturalWidth);
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(angle);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 16;
  ctx.drawImage(img, -w / 2, -h * anchorY, w, h);
  ctx.restore();
}

// Rasmni gorizontal "tasma"larga bo'lib chizadi. Har bir tasma o'z markazi,
// burchagi va kengligi bilan — natijada kiyim tana bilan birga egiladi va buriladi.
//   at(u) → { x, y, ang, sc }  (u: 0 — yuqori tayanch nuqta, 1 — pastki)
function drawStrips(img, w, h, anchorY, length, at) {
  const iw = img.naturalWidth, ih = img.naturalHeight, N = 28;
  const stripH = h / N;
  ctx.save();
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const u = ((t - anchorY) * h) / length;
    const { x, y, ang, sc } = at(u);
    ctx.setTransform(1, 0, 0, 1, x, y);
    ctx.rotate(ang);
    ctx.drawImage(img, 0, t * ih, iw, ih / N + 0.5, (-w * sc) / 2, 0, w * sc, stripH + 1.2);
  }
  ctx.restore();
}

// Ustki kiyim / ko'ylak: yelkadan belgacha
function warpTorso(img, f, { sMid, hMid, sw, hw, sA, hA }) {
  const L = Math.max(dist(sMid, hMid), sw * 0.6);          // ekrandagi gavda uzunligi
  const sv = clamp(L / (sw * 1.3), 0.8, 1.3);               // gavda kalta/uzun ko'rinsa — kiyim ham
  const ws = clamp(hw / 0.72 / sw, 0.88, 1.15);              // belga qarab torayish/kengayish
  const w = sw * f.w;
  const h = w * (img.naturalHeight / img.naturalWidth) * sv;
  drawStrips(img, w, h, f.y, L, (u) => {
    const k = clamp(u, 0, 1.6);
    return {
      x: sMid.x + (hMid.x - sMid.x) * u,
      y: sMid.y + (hMid.y - sMid.y) * u,
      ang: sA + (hA - sA) * k,
      sc: 1 + (ws - 1) * k,
    };
  });
}

// Shim: beldan to'piqqacha (to'piq ko'rinmasa — tizzagacha)
function warpLegs(img, f, { waist, end, endFrac, hw, hA }) {
  const legLen = dist(waist, end) / endFrac;                // beldan to'piqqacha taxminiy uzunlik
  const w = hw * f.w;
  const h0 = w * (img.naturalHeight / img.naturalWidth);
  const sv = clamp(legLen / ((0.97 - f.y) * h0), 0.7, 1.4);
  const h = h0 * sv;
  const dx = (end.x - waist.x) / endFrac, dy = (end.y - waist.y) / endFrac;
  drawStrips(img, w, h, f.y, legLen, (u) => ({
    x: waist.x + dx * u,
    y: waist.y + dy * u,
    ang: hA * (1 - clamp(u, 0, 1)),
    sc: 1,
  }));
}

// ============================================================
//  TO'PLAM (jonli rejimda bir nechta buyum)
// ============================================================
function wear(p) {
  const slot = SLOT[p.type];
  if (p.type === "dress") delete outfit.pants;                       // ko'ylak shimning o'rnini egallaydi
  if (p.type === "pants" && outfit.top?.type === "dress") delete outfit.top;
  outfit[slot] = p;
  garment(p);
  renderOutfit();
}

function renderOutfit() {
  const items = DRAW_ORDER.map((s) => outfit[s]).filter(Boolean).reverse();
  $("#outfit").hidden = items.length === 0;
  $("#outfitList").innerHTML = items.map((p) => `
    <div class="outfit__item">
      <img src="${p.cut}" alt="">
      <span>${p.name}</span>
      <button class="icon-btn" data-off="${SLOT[p.type]}" title="Yechish" aria-label="Yechish">✕</button>
    </div>`).join("");
  const sum = items.reduce((s, p) => s + p.price, 0);
  $("#outfitAdd").textContent = items.length > 1 ? `To'plamni savatga · ${formatPrice(sum)}` : "Savatga";
  document.querySelectorAll("#miniGrid button").forEach((b) =>
    b.classList.toggle("is-worn", items.some((p) => p.id === +b.dataset.id))
  );
}

// ============================================================
//  AI REJIM
// ============================================================

// Kameradan hozirgi kadrni olish (kiyimsiz, ko'zgu holatida)
function captureFrame() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return null;
  const scale = Math.min(1, 1024 / Math.max(vw, vh));
  const c = document.createElement("canvas");
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  const x = c.getContext("2d");
  x.translate(c.width, 0);
  x.scale(-1, 1);
  x.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

// Yuklangan rasmni kichraytirib dataURL ga aylantirish
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- 3-2-1 SANOQ ----------
let cdTimer = null, cdLeft = 3, cdWait = 0;

function framed() {
  if (!pose) return true;                       // tana modeli yo'q — tekshira olmaymiz
  const need = NEED[current.type] || NEED.top;
  return !!smooth && need.ids.every((i) => visible(smooth[i]));
}

function startCountdown() {
  if (!aiEnabled) return runAI(null);
  if (!stream || !video.videoWidth) {
    return showError("Kamera yoqilmagan. Brauzerda kameraga ruxsat bering yoki “⤒ Rasm yuklash” tugmasi orqali o'z rasmingizni yuklang.");
  }
  hideResult();
  cdLeft = 3; cdWait = 0;
  $("#countdown").classList.add("is-on");
  $("#cdNow").hidden = true;
  renderCountdown();
  cdTimer = setInterval(() => {
    if (!framed()) {
      cdLeft = 3; cdWait++;
      if (cdWait >= 4) $("#cdNow").hidden = false;   // uzoq kutsa — "baribir olish" imkoni
      return renderCountdown();
    }
    cdLeft--;
    if (cdLeft <= 0) return shoot();
    renderCountdown();
  }, 1000);
}

function renderCountdown() {
  const ok = framed();
  $("#cdNum").textContent = ok ? cdLeft : "…";
  $("#cdNum").classList.toggle("is-wait", !ok);
  $("#cdMsg").textContent = ok ? "Qimirlamang — surat olinmoqda" : (NEED[current.type] || NEED.top).msg;
  // sanoq raqami har soniyada "urilib" turishi uchun animatsiyani qayta boshlaymiz
  const n = $("#cdNum"); n.style.animation = "none"; void n.offsetWidth; n.style.animation = "";
}

function stopCountdown() {
  clearInterval(cdTimer); cdTimer = null;
  $("#countdown").classList.remove("is-on");
}

function shoot() {
  stopCountdown();
  const st = $(".tryon__stage");
  st.classList.remove("flash"); void st.offsetWidth; st.classList.add("flash");
  runAI(captureFrame());
}

// ---------- SO'ROV ----------
let lastPerson = null;
const results = []; // { pid, name, price, src, before }

async function runAI(person) {
  if (!aiEnabled) {
    return showError("AI hali ulanmagan. Loyiha papkasidagi .env faylga GEMINI_API_KEY yozing va serverni qayta ishga tushiring (QOLLANMA.md da yozilgan).");
  }
  if (!person) return showError("Kadr olinmadi. Kamerani yoqing yoki rasm yuklang.");
  lastPerson = person;
  const product = current;
  $("#aiPreview").src = person;
  $("#aiLoading").classList.add("is-on");
  $("#aiBtn").disabled = true;
  const t0 = Date.now();
  const timer = setInterval(() => ($("#aiTimer").textContent = `${Math.round((Date.now() - t0) / 1000)} s`), 500);
  try {
    const r = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, productId: product.id }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Server xatosi");
    const res = { pid: product.id, name: product.name, price: product.price, src: data.image, before: person };
    results.unshift(res);
    if (results.length > 8) results.pop();
    renderResults();
    showResult(res);
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "Server bilan aloqa yo'q. “node server.js” ishlayaptimi?" : err.message);
  } finally {
    clearInterval(timer);
    $("#aiLoading").classList.remove("is-on");
    $("#aiBtn").disabled = false;
  }
}

// ---------- NATIJA: OLDIN / KEYIN ----------
let shown = null;
function showResult(res) {
  shown = res;
  $("#aiCompare").classList.remove("is-on");
  $("#aiResultImg").src = res.src;
  $("#aiBeforeImg").src = res.before;
  $("#aiResultName").textContent = res.name;
  setCompare(false); // avval natija to'liq ko'rinadi; solishtirish — tugma bilan
  $("#aiResult").classList.add("is-on");
}
function setCompare(on) {
  $("#ba").classList.toggle("is-compare", on);
  $("#aiCmpToggle").classList.toggle("pill--red", on);
  $("#aiCmpToggle").textContent = on ? "✓ Natijani ko'rish" : "◐ Oldin / Keyin";
  setBA(on ? 50 : 0);
}
function setBA(v) {
  $("#baRange").value = v;
  $("#ba").style.setProperty("--pos", `${v}%`);
}
function hideResult() {
  $("#aiResult").classList.remove("is-on");
  $("#aiError").classList.remove("is-on");
  $("#aiCompare").classList.remove("is-on");
}
function showError(msg) {
  $("#aiErrorText").textContent = msg;
  $("#aiError").classList.add("is-on");
}

// ---------- NATIJALARIM VA SOLISHTIRISH ----------
function renderResults() {
  $("#results").hidden = results.length === 0;
  $("#cmpOpen").hidden = results.length < 2;
  $("#resStrip").innerHTML = results.map((r, i) =>
    `<button data-res="${i}" title="${r.name}"><img src="${r.src}" alt="${r.name}"></button>`
  ).join("");
}

function openCompare() {
  // har bir mahsulotning eng so'nggi natijasi, ko'pi bilan 4 ta
  const seen = new Set();
  const list = results.filter((r) => !seen.has(r.pid) && seen.add(r.pid)).slice(0, 4);
  $("#cmpGrid").style.setProperty("--n", list.length);
  $("#cmpGrid").innerHTML = list.map((r) => `
    <figure class="ai-compare__item">
      <img src="${r.src}" alt="${r.name}">
      <figcaption>
        <span>${r.name}</span><b>${formatPrice(r.price)}</b>
        <button class="pill pill--red" data-cart="${r.pid}">+ Savatga</button>
      </figcaption>
    </figure>`).join("");
  $("#aiResult").classList.remove("is-on");
  $("#aiCompare").classList.add("is-on");
}

// ============================================================
//  O'LCHAM TAVSIYASI
// ============================================================
// Yelka bo'g'imlari orasidagi masofa (sm) bo'yicha taxminiy o'lcham
const SIZE_CHART = [[33, "XS"], [36, "S"], [39, "M"], [42, "L"], [45, "XL"], [Infinity, "XXL"]];

try { const h = localStorage.getItem("kiyim-height"); if (h) $("#sizeHeight").value = h; } catch {}

function measureSize() {
  const H = +$("#sizeHeight").value;
  const out = $("#sizeOut");
  out.hidden = false;
  if (!(H >= 120 && H <= 220)) return (out.textContent = "Bo'yingizni santimetrda yozing (masalan, 168).");
  try { localStorage.setItem("kiyim-height", H); } catch {}
  if (!stream || !pose) return (out.textContent = "Kamera va tana modeli kerak. Kameraga ruxsat bering va bir oz kuting.");

  const samples = [];
  const btn = $("#sizeBtn");
  btn.disabled = true;
  out.textContent = "O'lchanmoqda… boshdan oyoqqacha ko'rinib, tik turing.";
  const started = Date.now();
  const t = setInterval(() => {
    const w = lastWorld;
    if (w && smooth && [0, 11, 12, 27, 28].every((i) => visible(smooth[i]))) {
      samples.push({ sh: dist3(w[11], w[12]), body: dist3(w[0], mid(w[27], w[28])) });
    }
    if (Date.now() - started < 3000) return;
    clearInterval(t);
    btn.disabled = false;
    if (samples.length < 8) {
      out.textContent = "Butun tanangiz ko'rinmadi. 2–3 qadam orqaga turing (boshdan oyoqqacha kadrda bo'lsin) va qayta bosing.";
      return;
    }
    const med = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
    // Burundan to'piqqacha ≈ bo'yning 88% i — shu orqali metrik o'lchamni bo'yga moslaymiz
    const shoulderCm = (med("sh") * (H * 0.88)) / med("body");
    const size = SIZE_CHART.find(([max]) => shoulderCm < max)[1];
    out.innerHTML = `Sizga taxminan <b>${size}</b> o'lcham mos keladi <span class="mono">· yelka ≈ ${Math.round(shoulderCm)} sm</span><br><small>Bu taxminiy hisob. Oversize kiyimlarda bir o'lcham kichigini ham ko'rib chiqing.</small>`;
  }, 100);
}

// ============================================================
//  MAHSULOTNI TANLASH
// ============================================================
function select(id) {
  current = window.byId(id);
  if (current.live) wear(current);
  const cat = CATEGORIES.find((c) => c.id === current.cat);
  $("#curImg").innerHTML = `<img src="${current.img}" alt="">`;
  $("#curCat").textContent = cat.name;
  $("#curName").textContent = current.name;
  $("#curPrice").textContent = formatPrice(current.price);
  $("#curAdd").textContent = `Savatga · ${formatPrice(current.price).toUpperCase()}`;
  document.querySelectorAll("#miniGrid button").forEach((b) =>
    b.classList.toggle("is-active", +b.dataset.id === id)
  );
}

function renderMini() {
  $("#miniGrid").innerHTML = PRODUCTS.map(
    (p) => `<button data-id="${p.id}" class="${p.id === current.id ? "is-active" : ""}" title="${p.name}">
              <img src="${p.cut}" alt="" loading="lazy">${p.live ? "" : "<i>AI</i>"}
            </button>`
  ).join("");
  renderOutfit();
}

function step(dir) {
  const i = PRODUCTS.findIndex((p) => p.id === current.id);
  select(PRODUCTS[(i + dir + PRODUCTS.length) % PRODUCTS.length].id);
}

function setStatus(msg) {
  $("#status").textContent = msg;
  $("#status").classList.toggle("is-hidden", !msg);
}

function download(src, name) {
  const a = document.createElement("a");
  a.href = src;
  a.download = name;
  a.click();
}

function snapshot() {
  download(canvas.toDataURL("image/png"), `kiyim-${current.id}.png`);
  const st = $(".tryon__stage");
  st.classList.remove("flash"); void st.offsetWidth; st.classList.add("flash");
}

// ---------- TUGMALAR ----------
$("#miniGrid").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (b) { hideResult(); select(+b.dataset.id); }
});
$("#tryonClose").addEventListener("click", closeTryOn);
$("#curAdd").addEventListener("click", () => window.Cart.add(current.id));
$("#snap").addEventListener("click", snapshot);
$("#toggleGuide").addEventListener("click", (e) => {
  showGuide = !showGuide;
  e.currentTarget.classList.toggle("is-off", !showGuide);
});

$("#aiBtn").addEventListener("click", startCountdown);
$("#cdCancel").addEventListener("click", stopCountdown);
$("#cdNow").addEventListener("click", shoot);
$("#uploadInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) { hideResult(); runAI(await fileToDataURL(file)); }
});
$("#aiRetry").addEventListener("click", () => { hideResult(); lastPerson ? runAI(lastPerson) : startCountdown(); });
$("#aiBack").addEventListener("click", hideResult);
$("#aiErrorClose").addEventListener("click", hideResult);
$("#aiSave").addEventListener("click", () => shown && download(shown.src, `kiyim-ai-${shown.pid}.png`));
$("#aiAdd").addEventListener("click", () => shown && window.Cart.add(shown.pid));
$("#baRange").addEventListener("input", (e) => setBA(+e.target.value));
$("#aiCmpToggle").addEventListener("click", () => setCompare(!$("#ba").classList.contains("is-compare")));

$("#resStrip").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-res]");
  if (b) showResult(results[+b.dataset.res]);
});
$("#cmpOpen").addEventListener("click", openCompare);
$("#cmpClose").addEventListener("click", hideResult);
$("#cmpGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cart]");
  if (b) window.Cart.add(+b.dataset.cart);
});

$("#outfitList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-off]");
  if (b) { delete outfit[b.dataset.off]; renderOutfit(); }
});
$("#outfitClear").addEventListener("click", () => {
  for (const k of Object.keys(outfit)) delete outfit[k];
  renderOutfit();
});
$("#outfitAdd").addEventListener("click", () => {
  DRAW_ORDER.map((s) => outfit[s]).filter(Boolean).forEach((p) => window.Cart.add(p.id));
});

$("#sizeBtn").addEventListener("click", measureSize);

document.addEventListener("keydown", (e) => {
  if (!$("#tryon").classList.contains("is-open")) return;
  if (e.target.matches("input")) return;
  if (e.key === "Escape") { if (cdTimer) return stopCountdown(); closeTryOn(); }
  if (e.key === "ArrowRight") { hideResult(); step(1); }
  if (e.key === "ArrowLeft") { hideResult(); step(-1); }
});
