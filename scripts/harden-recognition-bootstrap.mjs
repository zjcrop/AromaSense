import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputs = [
  resolve(root, "mobile/android/app/src/main/assets/www/index.html"),
  resolve(root, "site/index.html")
];
const key = "aromasense.luckybean-recognition-book.v1";
const runtimeMarker = "__AROMASENSE_RECOGNITION_BOOK__";

function optimize(html, filename) {
  const cacheMarker = `localStorage.setItem(${JSON.stringify(key)},`;
  if (!html.includes(cacheMarker)) throw new Error(`Recognition bootstrap not found in ${filename}`);

  // Do not JSON.parse the full recognition/codebook payload at application boot.
  // Keeping the serialized source in localStorage allows LuckyBean/Foundation to
  // materialize it only when the user actually starts recognition or canonical
  // resolution. This removes one large always-resident object graph from the
  // normal homepage lifecycle while retaining offline recognition capability.
  if (html.includes(`globalThis.${runtimeMarker}=JSON.parse(raw)`)) {
    throw new Error(`Eager in-memory recognition book leaked into ${filename}`);
  }
  return html;
}

for (const filename of outputs) {
  const html = await readFile(filename, "utf8");
  await writeFile(filename, optimize(html, filename), "utf8");
}

console.log("Recognition bootstrap optimized: serialized cache + lazy in-memory materialization");
