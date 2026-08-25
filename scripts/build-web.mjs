import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const androidOut = resolve(root, "mobile/android/app/src/main/assets/www");
const pagesOut = resolve(root, "site");
const cloudBaseUrl = process.env.AROMASENSE_CLOUD_URL ?? "";
const firebaseApiKey = process.env.AROMASENSE_FIREBASE_API_KEY || "AIzaSyCgeidfyGK4-TnWwBkiO-KWQ0TYNn46G84";
const firebaseProjectId = process.env.AROMASENSE_FIREBASE_PROJECT_ID || "aromasense-139da";
const recognitionCacheKey = "aromasense.luckybean-recognition-book.v1";
const recognitionCodebookUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json";
const recognitionLexiconUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_label_lexicon_v1.json";

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function validateRecognitionBook(book) {
  for (const table of ["countries", "regions", "entities", "varieties", "processes", "flavors"]) {
    if (!Array.isArray(book?.[table]) || book[table].length === 0) {
      throw new Error(`LuckyBean recognition codebook is missing ${table}`);
    }
  }
  return book;
}

async function buildRecognitionBootstrap() {
  try {
    const [rawBook, rawLexicon] = await Promise.all([
      fetchJson(recognitionCodebookUrl),
      fetchJson(recognitionLexiconUrl)
    ]);
    validateRecognitionBook(rawBook);
    const book = {
      version: rawBook.version,
      countries: rawBook.countries,
      regions: rawBook.regions,
      entities: rawBook.entities,
      varieties: rawBook.varieties,
      processes: rawBook.processes,
      flavors: rawBook.flavors,
      labelLexicon: {
        version: rawLexicon?.version,
        fields: rawLexicon?.fields ?? {}
      }
    };
    const serialized = JSON.stringify(book);
    const literal = JSON.stringify(serialized)
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    return `<script>(()=>{try{localStorage.setItem(${JSON.stringify(recognitionCacheKey)},${literal});}catch(_){}})();</script>`;
  } catch (error) {
    if (process.env.CI) throw error;
    console.warn(`LuckyBean recognition codebook was not bundled: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

const recognitionBootstrap = await buildRecognitionBootstrap();

async function buildTarget(out) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await build({
    entryPoints: [resolve(root, "app/runtime/web-entry.ts")],
    outfile: resolve(out, "app.js"),
    bundle: true,
    platform: "browser",
    target: ["chrome110"],
    format: "iife",
    sourcemap: true,
    loader: { ".sql": "text" },
    legalComments: "none"
  });

  for (const file of ["aromasense-cupping.css", "product-shell.css", "batch-setup.css", "account.css", "startup.css"]) {
    await cp(resolve(root, `app/ui/dom/${file}`), resolve(out, file));
  }

  await cp(resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm"), resolve(out, "sql-wasm.wasm"));

  const template = await readFile(resolve(root, "web/index.template.html"), "utf8");
  const html = template
    .replaceAll("__CLOUD_BASE_URL__", escapeAttribute(cloudBaseUrl))
    .replaceAll("__FIREBASE_API_KEY__", escapeAttribute(firebaseApiKey))
    .replaceAll("__FIREBASE_PROJECT_ID__", escapeAttribute(firebaseProjectId))
    .replace("  <script src=\"app.js\"></script>", `${recognitionBootstrap ? `  ${recognitionBootstrap}\n` : ""}  <script src=\"app.js\"></script>`);
  await writeFile(resolve(out, "index.html"), html, "utf8");
  await writeFile(resolve(out, ".nojekyll"), "", "utf8");
}

await buildTarget(androidOut);
await buildTarget(pagesOut);
