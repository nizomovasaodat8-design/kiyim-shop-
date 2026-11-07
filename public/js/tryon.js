// ============================================================
//  KIYINISH XONASI — ikki rejim:
//
//  1) JONLI rejim (bepul, darhol):
//     kamera → MediaPipe Pose tanadagi nuqtalarni topadi →
//     kiyimning foni olib tashlangan surati shu nuqtalarga yopishadi.
//
//  2) AI rejim (haqiqiy ko'rinish):
//     kameradan bitta kadr olinadi → serverga (/api/tryon) yuboriladi →
//     server Gemini AI'dan "shu odam shu kiyimda" rasmini so'raydi.
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

let stream = null, pose = null, current = null, garmentImg = null;
let smooth = null, running = false, showGuide = true, aiEnabled = false;
let lastTime = -1;

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
    const lm = pose.detectForVideo(video, performance.now()).landmarks?.[0];
    smooth = lm ? smoothLandmarks(smooth, lm) : null;
  }

  const found = !!smooth && visible(smooth[11]) && visible(smooth[12]);
  const live = current.live;
  $("#guide").classList.toggle("is-hidden", !showGuide || found);
  $("#hint").textContent = !live ? "Bu buyum AI rejimda kiyiladi ↓" : "Chiziqlar ichiga turing";
  $("#hint").classList.toggle("is-hidden", live ? found || !showGuide : false);
  $("#badge").textContent = found ? "✦ Jonli rejim · tana topildi" : "✦ Jonli rejim";

  if (live && garmentImg?.complete && garmentImg.naturalWidth && found) drawOnBody(smooth, view);
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
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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

// ---------- KIYIMNI TANAGA JOYLASH ----------
function drawOnBody(lm, v) {
  const P = (i) => toPx(lm[i], v);
  const f = { ...FIT[current.type], ...current.fit };
  const ls = P(11), rs = P(12);
  const sw = dist(ls, rs), sMid = mid(ls, rs);
  const hipsOk = visible(lm[23]) && visible(lm[24]);
  const hw = hipsOk ? dist(P(23), P(24)) : sw * 0.72;
  const hMid = hipsOk ? mid(P(23), P(24)) : { x: sMid.x, y: sMid.y + sw * 1.3 };

  switch (current.type) {
    case "top":   return place(sMid, sw * f.w, f.y, level(ls, rs));
    case "dress": return place(sMid, sw * f.w, f.y, level(ls, rs));
    case "pants": return place({ x: hMid.x, y: hMid.y - hw * 0.15 }, hw * f.w, f.y, level(P(23), P(24)));
    case "hat": {
      const le = P(7), re = P(8), head = dist(le, re), eyes = mid(P(2), P(5));
      return place({ x: eyes.x, y: eyes.y - head * 0.3 }, head * f.w, f.y, level(le, re));
    }
    case "glasses": {
      const lo = P(3), ro = P(6);
      return place(mid(lo, ro), dist(lo, ro) * f.w, f.y, level(lo, ro));
    }
    case "bag": {
      const side = ls.x > rs.x ? ls : rs;
      return place({ x: side.x + sw * 0.2, y: side.y + sw * 0.5 }, sw * f.w, f.y, 0);
    }
    case "shoes": {
      if (!(visible(lm[27]) && visible(lm[28]))) return;
      return place(mid(P(27), P(28)), hw * f.w, f.y, 0);
    }
  }
}

// Rasmni tabiiy nisbatida (cho'zmasdan) joylash
function place(anchor, w, anchorY, angle) {
  const h = w * (garmentImg.naturalHeight / garmentImg.naturalWidth);
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(angle);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 16;
  ctx.drawImage(garmentImg, -w / 2, -h * anchorY, w, h);
  ctx.restore();
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

let lastPerson = null;
async function runAI(person) {
  if (!aiEnabled) {
    return showError("AI hali ulanmagan. Loyiha papkasidagi .env faylga GEMINI_API_KEY yozing va serverni qayta ishga tushiring (QOLLANMA.md da yozilgan).");
  }
  if (!person) return showError("Kadr olinmadi. Kamerani yoqing yoki rasm yuklang.");
  lastPerson = person;
  $("#aiPreview").src = person;
  $("#aiLoading").classList.add("is-on");
  $("#aiBtn").disabled = true;
  const t0 = Date.now();
  const timer = setInterval(() => ($("#aiTimer").textContent = `${Math.round((Date.now() - t0) / 1000)} s`), 500);
  try {
    const r = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, productId: current.id }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Server xatosi");
    showResult(data.image);
  } catch (err) {
    showError(err.message === "Failed to fetch" ? "Server bilan aloqa yo'q. “node server.js” ishlayaptimi?" : err.message);
  } finally {
    clearInterval(timer);
    $("#aiLoading").classList.remove("is-on");
    $("#aiBtn").disabled = false;
  }
}

function showResult(src) {
  $("#aiResultImg").src = src;
  $("#aiResult").classList.add("is-on");
  $("#aiResultName").textContent = current.name;
}
function hideResult() {
  $("#aiResult").classList.remove("is-on");
  $("#aiError").classList.remove("is-on");
}
function showError(msg) {
  $("#aiErrorText").textContent = msg;
  $("#aiError").classList.add("is-on");
}

// ---------- MAHSULOTNI TANLASH ----------
function select(id) {
  current = window.byId(id);
  garmentImg = new Image();
  garmentImg.src = current.cut;
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
$("#aiBtn").addEventListener("click", () => { hideResult(); runAI(captureFrame()); });
$("#uploadInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) { hideResult(); runAI(await fileToDataURL(file)); }
});
$("#aiRetry").addEventListener("click", () => { hideResult(); runAI(lastPerson); });
$("#aiBack").addEventListener("click", hideResult);
$("#aiErrorClose").addEventListener("click", hideResult);
$("#aiSave").addEventListener("click", () => download($("#aiResultImg").src, `kiyim-ai-${current.id}.png`));
$("#aiAdd").addEventListener("click", () => window.Cart.add(current.id));

document.addEventListener("keydown", (e) => {
  if (!$("#tryon").classList.contains("is-open")) return;
  if (e.key === "Escape") closeTryOn();
  if (e.key === "ArrowRight") { hideResult(); step(1); }
  if (e.key === "ArrowLeft") { hideResult(); step(-1); }
});
