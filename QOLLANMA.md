# Kiyim — virtual kiyib ko'rish do'koni

## 1. Ishga tushirish (3 qadam)

**1-qadam.** Kompyuteringizda Node.js bo'lishi kerak (sizda bor: `node --version`).

**2-qadam.** `.env` faylida sozlamalar turadi (namuna: `.env.example`). Hech narsa yozmasangiz ham AI ishlaydi:

| AI rejimi | Nima kerak | Qaysi buyumlar |
|---|---|---|
| **Bepul** (standart) | hech narsa | kurtka, ko'ylak, futbolka, ko'ylak (dress), shim |
| Bepul + ko'proq limit | `HF_TOKEN` — <https://huggingface.co/settings/tokens> (bepul akkaunt → New token → Read) | yuqoridagilar |
| **Gemini** (pullik, eng aqlli) | `GEMINI_API_KEY` + AI Studio'da Billing | hammasi, ko'zoynak va shlyapa ham |

Kalitni VS Code'siz kiritish ham mumkin: server ishlab turganda **http://localhost:3000/sozlash.html** ni oching.

> Bepul AI — Hugging Face'dagi IDM-VTON va OOTDiffusion modellari. Bitta rasm 15–40 soniya oladi. Kunlik GPU limiti bor: tugasa, bir oz kuting yoki `HF_TOKEN` qo'shing. Gemini ulangan bo'lsa-yu limiti tugasa, server avtomatik bepul modelga o'tadi.

**3-qadam.** Shu papkada terminal oching va quyidagini yozing:

```bash
node server.js
```

Brauzerda **http://localhost:3000** manzilini oching.

## 2. Nimalar ishlaydi

| Qism | Qanday ishlaydi |
|---|---|
| Katalog | 28 ta haqiqiy kiyim surati, 7 ta kategoriya |
| Jonli kiyib ko'rish | Kamera + MediaPipe Pose → kiyimning foni olib tashlangan surati tanangizga yopishadi |
| AI kiyib ko'rish | Kameradan kadr (yoki yuklangan rasm) + kiyim surati → Gemini → siz shu kiyimda |
| Savat | Brauzerda saqlanadi, sonini o'zgartirish mumkin |
| Buyurtma | Ism, telefon, manzil → `data/orders.json` ga yoziladi (+ Telegramga xabar) |
| Admin | http://localhost:3000/admin.html — buyurtmalar ro'yxati (parol bilan) |

## 3. Fayllar tuzilishi

```
kiyim-shop/
├── server.js            ← backend: sayt, AI, buyurtmalar
├── .env                 ← maxfiy kalitlar (o'zingiz yaratasiz)
├── data/orders.json     ← buyurtmalar (avtomatik paydo bo'ladi)
└── public/              ← brauzerga ko'rinadigan hamma narsa
    ├── index.html       ← sahifa
    ├── admin.html       ← admin panel
    ├── css/style.css    ← dizayn
    ├── js/products.js   ← mahsulotlar ro'yxati (narxlar shu yerda!)
    ├── js/shop.js       ← katalog, savat, buyurtma
    ├── js/tryon.js      ← kamera, jonli rejim, AI rejim
    ├── img/products/    ← mahsulot suratlari
    └── img/cutout/      ← foni olib tashlangan suratlar (jonli rejim uchun)
```

## 4. Yangi mahsulot qo'shish

1. Suratni `public/img/products/` ga qo'ying (masalan `kurtka.jpg`).
2. Fonini olib tashlang (masalan remove.bg yoki Photoshop) va `public/img/cutout/kurtka.webp` qilib saqlang.
3. `public/js/products.js` dagi ro'yxatga bitta qator qo'shing.

## 5. Internetga chiqarish (keyingi qadam)

Sayt Node.js serverda ishlaydi, shuning uchun Render, Railway yoki VPS hosting kerak bo'ladi. U yerda `.env` dagi qiymatlarni hostingning "Environment variables" bo'limiga yozasiz. Kamera ishlashi uchun saytda **https** bo'lishi shart (bu hostinglar uni avtomatik beradi).

## Suratlar

Mahsulot suratlari [Unsplash](https://unsplash.com) va [Pexels](https://www.pexels.com) saytlaridan olingan (ikkalasining litsenziyasi ham bepul, tijoratda foydalanish mumkin). Qish kolleksiyasi suratlari Pexels’dan (`px-` bilan boshlanadi). Haqiqiy do'kon uchun o'z mahsulotlaringiz suratlarini qo'yasiz.
