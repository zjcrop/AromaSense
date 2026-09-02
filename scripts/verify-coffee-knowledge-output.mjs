import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const recognitionCacheKey = "aromasense.luckybean-recognition-book.v1";
const codebookUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json";
const outputs = [
  resolve(root, "site/index.html"),
  resolve(root, "mobile/android/app/src/main/assets/www/index.html")
];
const tables = ["countries", "regions", "entities", "varieties", "processes", "flavors"];

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

function embeddedBook(html) {
  const escapedKey = recognitionCacheKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`localStorage\\.setItem\\(${JSON.stringify(recognitionCacheKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,\\s*(\"(?:\\\\.|[^\"\\\\])*\")\\)`);
  const match = html.match(regex);
  if (!match) throw new Error(`Recognition bootstrap for ${escapedKey} not found`);
  const serialized = JSON.parse(match[1]);
  return JSON.parse(serialized);
}

function assertCoreUnchanged(source, bundled, label) {
  for (const table of tables) {
    const sourceRows = source[table] ?? [];
    const bundledRows = bundled[table] ?? [];
    if (sourceRows.length !== bundledRows.length) {
      throw new Error(`${label}: ${table} row count changed ${sourceRows.length} -> ${bundledRows.length}`);
    }
    sourceRows.forEach((row, index) => {
      const bundledRow = bundledRows[index];
      if (!bundledRow || bundledRow[0] !== row[0]) {
        throw new Error(`${label}: ${table}[${index}] QR code/index changed`);
      }
      const prefix = bundledRow.slice(0, row.length);
      if (JSON.stringify(prefix) !== JSON.stringify(row)) {
        throw new Error(`${label}: ${table}[${index}] original fields changed for ${row[0]}`);
      }
    });
  }
}

function rowByCode(book, table, code) {
  return (book[table] ?? []).find((row) => row?.[0] === code);
}

function assertAlias(book, table, code, alias, label) {
  const row = rowByCode(book, table, code);
  if (!row) throw new Error(`${label}: missing ${table} ${code}`);
  if (!row.some((value) => String(value ?? "").normalize("NFKC") === alias.normalize("NFKC"))) {
    throw new Error(`${label}: knowledge alias ${alias} not applied to ${code}`);
  }
}

const source = await fetchJson(codebookUrl);
for (const output of outputs) {
  const html = await readFile(output, "utf8");
  const book = embeddedBook(html);
  const label = output.replace(`${root}/`, "");
  if (book?.coffeeKnowledgeMeta?.qrIndexesChanged !== false) {
    throw new Error(`${label}: Coffee Knowledge compatibility marker missing`);
  }
  if (Number(book?.coffeeKnowledgeMeta?.aliasesApplied ?? 0) < 1) {
    throw new Error(`${label}: no Coffee Knowledge aliases were applied`);
  }
  assertCoreUnchanged(source, book, label);
  assertAlias(book, "varieties", "VA-GE", "ゲイシャ", label);
  assertAlias(book, "regions", "RG-EA-YIR", "예가체프", label);
  assertAlias(book, "processes", "PR-NA", "ナチュラル", label);
  console.log(`${label}: Coffee Knowledge ${book.coffeeKnowledgeMeta.version} verified; aliases=${book.coffeeKnowledgeMeta.aliasesApplied}; QR indexes unchanged`);
}
