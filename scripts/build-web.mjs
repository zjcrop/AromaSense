import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCoffeeKnowledgeConsumerSubset,
  buildCoffeeKnowledgeConsumerSubset
} from "./coffee-knowledge-consumer-subset.mjs";

const root = resolve(import.meta.dirname, "..");
const androidOut = resolve(root, "mobile/android/app/src/main/assets/www");
const pagesOut = resolve(root, "site");
const cloudBaseUrl = process.env.AROMASENSE_CLOUD_URL ?? "";
const firebaseApiKey = process.env.AROMASENSE_FIREBASE_API_KEY || "AIzaSyAsY_w3pxgBlnr0tFYKuAvNJUeEhN1RCU0";
const firebaseProjectId = process.env.AROMASENSE_FIREBASE_PROJECT_ID || "romasense-f23eb";
const buildId = (process.env.GITHUB_SHA || process.env.AROMASENSE_BUILD_ID || "dev").slice(0, 16);
const recognitionCacheKey = "aromasense.luckybean-recognition-book.v1";
const recognitionCodebookUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json";
const recognitionLexiconUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_label_lexicon_v1.json";
const coffeeKnowledgeManifestUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-knowledge/releases/latest.json";
const entityResolutionModelKey = "catalog/entity_resolution_issues_v1.json";
const requiredEntityResolutionIssueCount = 5;
const requiredPipelineVersion = "1.24P-recognition-pipeline.3";
const requiredEntitySafetyMarkers = [
  "candidateCoreCode",
  "manualConfirmationRequired",
  "historicalCoreCompatibility"
];
const requiredKnowledgeOnlyMarkers = [
  "knowledgeOnlyVariety",
  "knowledgeOnly",
  "qrCoreCode",
  "productionCoreApproved"
];
const requiredBrowserOcrMarkers = [
  "PP-OCRv5-browser-",
  "PP-OCRv5_mobile_det",
  "PP-OCRv5_mobile_rec",
  "textDetUnclipRatio",
  "ENGINE_INIT_TIMEOUT_MS",
  "PREDICT_TIMEOUT_MS",
  "luckybean-ppocr-v5",
  "workerOnly",
  "worker-direct"
];

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

async function fetchBytes(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchVerifiedCoffeeKnowledge() {
  const manifest = await fetchJson(coffeeKnowledgeManifestUrl);
  if (manifest?._format !== "coffee-knowledge-release-manifest" || manifest?.provider !== "brewion") {
    throw new Error("BrewIon Coffee Knowledge manifest identity is invalid");
  }
  if (manifest.contract !== "coffee-knowledge/1.0") {
    throw new Error(`Unsupported Coffee Knowledge contract: ${manifest.contract ?? "missing"}`);
  }
  if (manifest?.compatibility?.qrIndexesChanged === true) {
    throw new Error("Coffee Knowledge release illegally claims QR index ownership");
  }
  const artifact = manifest.artifact;
  if (!artifact?.name || !artifact?.sha256 || !Number.isFinite(Number(artifact.bytes))) {
    throw new Error("Coffee Knowledge release artifact metadata is incomplete");
  }
  const artifactUrl = new URL(artifact.name, coffeeKnowledgeManifestUrl).href;
  const bytes = await fetchBytes(artifactUrl);
  if (bytes.byteLength !== Number(artifact.bytes)) {
    throw new Error(`Coffee Knowledge bytes mismatch: ${bytes.byteLength} != ${artifact.bytes}`);
  }
  const hash = sha256Hex(bytes);
  if (hash.toLowerCase() !== String(artifact.sha256).toLowerCase()) {
    throw new Error("Coffee Knowledge SHA-256 verification failed");
  }
  const knowledge = JSON.parse(new TextDecoder().decode(bytes));
  if (knowledge?._format !== "coffee-knowledge-bundle" || knowledge?.contract !== "coffee-knowledge/1.0") {
    throw new Error("Coffee Knowledge artifact contract is invalid");
  }
  return { manifest, knowledge, hash };
}

function validateRecognitionBook(book) {
  for (const table of ["countries", "regions", "entities", "varieties", "processes", "flavors"]) {
    if (!Array.isArray(book?.[table]) || book[table].length === 0) {
      throw new Error(`LuckyBean recognition codebook is missing ${table}`);
    }
  }
  return book;
}

function localizedText(record) {
  return String(record?.alias ?? record?.name ?? "").normalize("NFKC").trim();
}

function usableKnowledgeAlias(record) {
  if (!record?.targetCode || !localizedText(record)) return false;
  const confidence = Number(record.confidence ?? 0.5);
  if (!Number.isFinite(confidence) || confidence < 0.65) return false;
  const type = String(record.nameType ?? "");
  if (["official", "canonical", "market_verified", "common"].includes(type)) return true;
  return ["ai_translated", "ai_transliterated"].includes(type)
    && String(record.reviewStatus ?? "").startsWith("pending");
}

function verifiedEntityResolutionIssues(knowledge, book) {
  const model = knowledge?.supplementalModels?.[entityResolutionModelKey];
  if (model?._format !== "coffee-entity-resolution-issues") {
    throw new Error("Coffee Knowledge entity-resolution model is missing or has an unexpected format");
  }
  if (model?.policy?.coreMutation !== false || model?.policy?.qrIndexChanged !== false) {
    throw new Error("Coffee Knowledge entity-resolution model violates frozen QR-core ownership");
  }
  if (model?.policy?.defaultConsumerAction !== "manual_confirmation_required") {
    throw new Error("Coffee Knowledge entity-resolution model has an unsafe default consumer action");
  }
  const entityCodes = new Set((book.entities ?? []).map((row) => String(row?.[0] ?? "")));
  const issues = (Array.isArray(model.issues) ? model.issues : [])
    .filter((issue) => issue?.coreCode && issue?.blockAutomaticEntityResolution === true)
    .map((issue) => structuredClone(issue));
  if (issues.length !== requiredEntityResolutionIssueCount) {
    throw new Error(`Expected ${requiredEntityResolutionIssueCount} blocked entity-resolution issues, received ${issues.length}`);
  }
  const seen = new Set();
  for (const issue of issues) {
    const code = String(issue.coreCode);
    if (seen.has(code)) throw new Error(`Duplicate blocked entity-resolution coreCode: ${code}`);
    seen.add(code);
    if (!entityCodes.has(code)) throw new Error(`Blocked entity-resolution coreCode is absent from v6 entities: ${code}`);
    if (!String(issue.issueClass ?? "") || !String(issue.resolutionStatus ?? "")) {
      throw new Error(`Blocked entity-resolution issue lacks classification/status: ${code}`);
    }
    if (!Array.isArray(issue.requiredContext) || issue.requiredContext.length === 0) {
      throw new Error(`Blocked entity-resolution issue lacks required context: ${code}`);
    }
  }
  return issues;
}

function applyKnowledgeAliases(book, knowledge, manifest, hash) {
  const tableNames = ["countries", "regions", "entities", "varieties", "processes", "flavors"];
  const rowsByCode = new Map();
  for (const table of tableNames) {
    for (const row of book[table] ?? []) {
      if (row?.[0]) rowsByCode.set(String(row[0]), row);
    }
  }
  const records = [
    ...(Array.isArray(knowledge.localizedNames) ? knowledge.localizedNames : []),
    ...(Array.isArray(knowledge.localizedAliases) ? knowledge.localizedAliases : [])
  ];
  const seen = new Set();
  let applied = 0;
  for (const record of records) {
    if (!usableKnowledgeAlias(record)) continue;
    const row = rowsByCode.get(String(record.targetCode));
    if (!row) continue;
    const text = localizedText(record);
    const key = `${record.targetCode}\u0000${text.toLocaleLowerCase("zh-CN")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exists = row.some((value) => typeof value === "string"
      && value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN") === text.toLocaleLowerCase("zh-CN"));
    if (!exists) row.push(text);
    applied += 1;
  }

  const entityResolutionIssues = verifiedEntityResolutionIssues(knowledge, book);
  const blockedAutomaticEntityCodes = entityResolutionIssues.map((issue) => String(issue.coreCode));
  const knowledgeConsumerSubset = buildCoffeeKnowledgeConsumerSubset(knowledge);
  const knowledgeOnlyVarietyCount = assertCoffeeKnowledgeConsumerSubset(knowledgeConsumerSubset);
  book.coffeeKnowledgeMeta = {
    contract: knowledge.contract,
    version: knowledge.version,
    manifestVersion: manifest.version,
    sha256: hash,
    aliasesApplied: applied,
    canonicalEntityIdentityGroups: Number(knowledge?.counts?.canonicalEntityIdentityGroups ?? 0),
    canonicalGeoIdentityGroups: Number(knowledge?.counts?.canonicalGeoIdentityGroups ?? 0),
    blockedAutomaticEntityResolutionCount: entityResolutionIssues.length,
    knowledgeOnlyVarietyCount,
    qrIndexesChanged: false
  };
  // Keep only consumer-facing knowledge instead of duplicating the complete
  // Coffee Knowledge artifact. Core-code aliases and entity safety remain in the
  // client contract; unbound varieties are supplied only as sourced recognition
  // candidates and can never acquire QR ownership in AromaSense.
  book.coffeeKnowledgeClient = {
    contract: knowledge.contract,
    version: String(knowledge.version ?? ""),
    entityResolutionIssues,
    blockedAutomaticEntityCodes,
    qrIndexesChanged: false
  };
  book.coffeeKnowledge = knowledgeConsumerSubset;
  return book;
}

async function buildRecognitionBootstrap() {
  try {
    const [rawBook, rawLexicon, verifiedKnowledge] = await Promise.all([
      fetchJson(recognitionCodebookUrl),
      fetchJson(recognitionLexiconUrl),
      fetchVerifiedCoffeeKnowledge()
    ]);
    validateRecognitionBook(rawBook);
    const book = {
      version: rawBook.version,
      countries: structuredClone(rawBook.countries),
      regions: structuredClone(rawBook.regions),
      entities: structuredClone(rawBook.entities),
      varieties: structuredClone(rawBook.varieties),
      processes: structuredClone(rawBook.processes),
      flavors: structuredClone(rawBook.flavors),
      labelLexicon: {
        version: rawLexicon?.version,
        updatedAt: rawLexicon?.updatedAt ?? "",
        fields: rawLexicon?.fields ?? {},
        valueAliases: rawLexicon?.valueAliases ?? {},
        dateRecognition: rawLexicon?.dateRecognition ?? {},
        harvestRecognition: rawLexicon?.harvestRecognition ?? {},
        numericRecognition: rawLexicon?.numericRecognition ?? {}
      }
    };
    applyKnowledgeAliases(book, verifiedKnowledge.knowledge, verifiedKnowledge.manifest, verifiedKnowledge.hash);
    validateRecognitionBook(book);
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

async function validateRecognitionArtifacts(out, { android = false } = {}) {
  const coreSource = await readFile(resolve(out, "luckybean-recognition-core.js"), "utf8");
  if (!coreSource.includes(requiredPipelineVersion)) {
    throw new Error(`LuckyBean production recognition pipeline missing from artifact: ${requiredPipelineVersion}`);
  }
  for (const marker of requiredEntitySafetyMarkers) {
    if (!coreSource.includes(marker)) {
      throw new Error(`LuckyBean entity-resolution safety implementation missing from artifact: ${marker}`);
    }
  }
  for (const marker of requiredKnowledgeOnlyMarkers) {
    if (!coreSource.includes(marker)) {
      throw new Error(`LuckyBean knowledge-only variety safety implementation missing from artifact: ${marker}`);
    }
  }
  if (!coreSource.includes("preparePackageImage") || !coreSource.includes("recognizeCoffeeBag")) {
    throw new Error("LuckyBean production image/OCR pipeline missing from artifact");
  }
  for (const marker of requiredBrowserOcrMarkers) {
    if (!coreSource.includes(marker)) {
      throw new Error(`LuckyBean production Worker-only OCR implementation missing from artifact: ${marker}`);
    }
  }
  if (
    coreSource.includes("tesseract.js-6.0.1-cn-mixed") ||
    coreSource.includes("otsuThreshold") ||
    coreSource.includes("recognition-quality-controller")
  ) {
    throw new Error("Deprecated main-thread image/OCR implementation leaked into production recognition artifact");
  }
  if (android) {
    for (const marker of ["LuckyBeanNativeRecognition", "recognizeImage", "native-direct", "nativeSource: android"]) {
      if (!coreSource.includes(marker)) throw new Error(`LuckyBean Android direct-URI OCR path missing from artifact: ${marker}`);
    }
  } else if (coreSource.includes("globalThis.__LUCKYBEAN_ANDROID__ = true")) {
    throw new Error("Android-only LuckyBean native bridge leaked into Pages artifact");
  }
  const appSource = await readFile(resolve(out, "app.js"), "utf8");
  if (/1\.24B-compat|luckyBeanCompat|parseLuckyBeanSemanticText/.test(appSource)) {
    throw new Error("Deprecated AromaSense LuckyBean compatibility parser leaked into production artifact");
  }
}

async function buildTarget(out, { android = false } = {}) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await build({
    entryPoints: [resolve(root, android
      ? "app/vendor/luckybean-recognition-android-entry.js"
      : "app/vendor/luckybean-recognition-entry.js")],
    outfile: resolve(out, "luckybean-recognition-core.js"),
    bundle: true,
    platform: "browser",
    target: ["chrome110"],
    format: "iife",
    sourcemap: true,
    legalComments: "none"
  });

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

  await validateRecognitionArtifacts(out, { android });

  for (const file of [
    "aromasense-cupping.css",
    "product-shell.css",
    "batch-setup.css",
    "account.css",
    "startup.css",
    "luckybean-flat-theme.css",
    "release-0.1c.css",
    "import-0.1c.css",
    "mobile-ocr-emergency.css"
  ]) {
    await cp(resolve(root, `app/ui/dom/${file}`), resolve(out, file));
  }

  await cp(resolve(root, "node_modules/sql.js/dist/sql-wasm.wasm"), resolve(out, "sql-wasm.wasm"));

  const template = await readFile(resolve(root, "web/index.template.html"), "utf8");
  const html = template
    .replaceAll("__CLOUD_BASE_URL__", escapeAttribute(cloudBaseUrl))
    .replaceAll("__FIREBASE_API_KEY__", escapeAttribute(firebaseApiKey))
    .replaceAll("__FIREBASE_PROJECT_ID__", escapeAttribute(firebaseProjectId))
    .replaceAll("__BUILD_ID__", escapeAttribute(buildId))
    .replace(
      "  <script src=\"app.js\"></script>",
      `${recognitionBootstrap ? `  ${recognitionBootstrap}\n` : ""}  <script src=\"luckybean-recognition-core.js?v=${encodeURIComponent(buildId)}\"></script>\n  <script src=\"app.js?v=${encodeURIComponent(buildId)}\"></script>`
    );
  await writeFile(resolve(out, "index.html"), html, "utf8");
  await writeFile(resolve(out, ".nojekyll"), "", "utf8");
}

await buildTarget(androidOut, { android: true });
await buildTarget(pagesOut, { android: false });