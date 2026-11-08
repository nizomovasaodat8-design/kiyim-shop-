// Fonni olib tashlash — alohida jarayonda ishlaydi, chunki imgly va transformers
// har xil "sharp" versiyasini olib keladi va bitta jarayonda to'qnashadi.
//   node tools/_fon.mjs <kirish.jpg> <chiqish.png>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeBackground } from "@imgly/background-removal-node";

// Model fayllari tools/node_modules ichida — qaysi papkadan ishga tushirilsa ham topilsin
const here = path.dirname(fileURLToPath(import.meta.url));
const publicPath = pathToFileURL(path.join(here, "node_modules/@imgly/background-removal-node/dist/")).href;

const [, , src, dst] = process.argv;
const blob = await removeBackground(new Blob([fs.readFileSync(src)], { type: "image/jpeg" }), {
  publicPath,
  output: { format: "image/png" },
});
fs.writeFileSync(dst, Buffer.from(await blob.arrayBuffer()));
