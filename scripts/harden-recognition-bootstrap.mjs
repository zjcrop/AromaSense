import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputs = [
  resolve(root, "mobile/android/app/src/main/assets/www/index.html"),
  resolve(root, "site/index.html")
];
const key = "aromasense.luckybean-recognition-book.v1";
const runtimeMarker = "__AROMASENSE_RECOGNITION_BOOK__";

function harden(html, filename) {
  if (html.includes(runtimeMarker)) return html;

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<script>\\(\\(\\)=>\\{try\\{localStorage\\.setItem\\((\"${escapedKey}\"),(.+)\\);\\}catch\\(_\\)\\{\\}\\}\\)\\(\\);<\\/script>`
  );
  const match = html.match(pattern);
  if (!match) throw new Error(`Recognition bootstrap not found in ${filename}`);

  const [, keyLiteral, payloadLiteral] = match;
  const replacement = `<script>(()=>{const raw=${payloadLiteral};try{globalThis.${runtimeMarker}=JSON.parse(raw);}catch(_){globalThis.${runtimeMarker}=undefined;}try{localStorage.setItem(${keyLiteral},raw);}catch(_){}})();</script>`;
  const next = html.replace(pattern, replacement);

  if (!next.includes(runtimeMarker) || !next.includes(`localStorage.setItem(${keyLiteral},raw)`)) {
    throw new Error(`Recognition bootstrap hardening failed for ${filename}`);
  }
  return next;
}

for (const filename of outputs) {
  const html = await readFile(filename, "utf8");
  await writeFile(filename, harden(html, filename), "utf8");
}

console.log("Recognition bootstrap hardened: in-memory primary + localStorage fallback");
