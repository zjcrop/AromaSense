import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  RECOGNITION_PIPELINE_VERSION,
  analyzeRecognitionDocument,
  recognitionDocumentFromText
} from "luckybean-static-app/src/recognition-core.js";

const root = resolve(import.meta.dirname, "..");
const recognitionCacheKey = "aromasense.luckybean-recognition-book.v1";
const recognitionRuntimeKey = "__AROMASENSE_RECOGNITION_BOOK__";
const codebookUrl = "https://raw.githubusercontent.com/zjcrop/BrewIon/main/coffee-qr-codebook/coffee_qr_codebook_v6.json";
const outputs = [
  resolve(root, "site/index.html"),
  resolve(root, "mobile/android/app/src/main/assets/www/index.html")
];
const tables = ["countries", "regions", "entities", "varieties", "processes", "flavors"];
const requiredPipelineVersion = "1.24P-recognition-pipeline.3";
const minimumKnowledgeOnlyVarietyCount = 16;
const expectedBlockedEntityCodes = [
  "ST-CN-ZHU@深度研究",
  "ST-CO-JOS@深度研究",
  "ST-CO-MIR@深度研究",
  "ST-CO-DIV@深度研究",
  "ST-PE-HUA@深度研究"
];

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
  const encodedJsonString = '("(?:\\\\.|[^"\\\\])*")';
  const runtimeRegex = new RegExp(
    `const\\s+raw\\s*=\\s*${encodedJsonString}\\s*;\\s*try\\{globalThis\\.${recognitionRuntimeKey}=JSON\\.parse\\(raw\\)`
  );
  const runtimeMatch = html.match(runtimeRegex);
  if (runtimeMatch) return JSON.parse(JSON.parse(runtimeMatch[1]));

  // Retain a legacy parser only to make failures diagnostic when an old build
  // accidentally bypasses the hardening step. The loop below still requires
  // the runtime-memory marker, so a legacy-only artifact cannot pass CI.
  const legacyRegex = new RegExp(
    `localStorage\\.setItem\\(${JSON.stringify(recognitionCacheKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,\\s*${encodedJsonString}\\)`
  );
  const legacyMatch = html.match(legacyRegex);
  if (legacyMatch) return JSON.parse(JSON.parse(legacyMatch[1]));

  throw new Error(`Recognition bootstrap for ${recognitionCacheKey} not found`);
}

function assertHardenedBootstrap(html, label) {
  if (!html.includes(`globalThis.${recognitionRuntimeKey}=JSON.parse(raw)`)) {
    throw new Error(`${label}: in-memory recognition book bootstrap is missing`);
  }
  if (!html.includes(`localStorage.setItem(${JSON.stringify(recognitionCacheKey)},raw)`)) {
    throw new Error(`${label}: durable recognition book cache fallback is missing`);
  }
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
      if (JSON.stringify(bundledRow.slice(0, row.length)) !== JSON.stringify(row)) {
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

function assertEntityResolutionSafety(book, label) {
  const client = book?.coffeeKnowledgeClient;
  if (client?.contract !== "coffee-knowledge/1.0" || client?.qrIndexesChanged !== false) {
    throw new Error(`${label}: Coffee Knowledge client safety contract missing or incompatible`);
  }
  const issues = Array.isArray(client.entityResolutionIssues) ? client.entityResolutionIssues : [];
  const blockedCodes = Array.isArray(client.blockedAutomaticEntityCodes)
    ? client.blockedAutomaticEntityCodes.map(String)
    : [];
  if (issues.length !== expectedBlockedEntityCodes.length) {
    throw new Error(`${label}: expected ${expectedBlockedEntityCodes.length} entity-resolution issues, found ${issues.length}`);
  }
  if (Number(book?.coffeeKnowledgeMeta?.blockedAutomaticEntityResolutionCount) !== expectedBlockedEntityCodes.length) {
    throw new Error(`${label}: blocked entity-resolution count metadata is inconsistent`);
  }
  const uniqueBlocked = new Set(blockedCodes);
  if (uniqueBlocked.size !== expectedBlockedEntityCodes.length) {
    throw new Error(`${label}: blocked entity code list contains duplicates or omissions`);
  }
  for (const code of expectedBlockedEntityCodes) {
    if (!uniqueBlocked.has(code)) throw new Error(`${label}: blocked entity coreCode missing: ${code}`);
    if (!rowByCode(book, "entities", code)) throw new Error(`${label}: blocked entity is absent from v6 core: ${code}`);
    const issue = issues.find((item) => String(item?.coreCode ?? "") === code);
    if (!issue || issue.blockAutomaticEntityResolution !== true) {
      throw new Error(`${label}: automatic entity resolution is not blocked for ${code}`);
    }
    if (!String(issue.issueClass ?? "") || !String(issue.resolutionStatus ?? "")) {
      throw new Error(`${label}: blocked entity lacks issue classification/status: ${code}`);
    }
    if (!Array.isArray(issue.requiredContext) || issue.requiredContext.length === 0) {
      throw new Error(`${label}: blocked entity lacks required disambiguation context: ${code}`);
    }
  }
}

function assertKnowledgeOnlySubset(book, label) {
  const subset = book?.coffeeKnowledge;
  if (subset?._format !== "coffee-knowledge-bundle" || subset?.contract !== "coffee-knowledge/1.0") {
    throw new Error(`${label}: knowledge-only consumer subset is missing`);
  }
  if (subset?.compatibility?.qrIndexesChanged !== false) {
    throw new Error(`${label}: knowledge-only consumer subset violates frozen QR indexes`);
  }
  const details = Array.isArray(subset?.unboundKnowledge?.varietyDetails)
    ? subset.unboundKnowledge.varietyDetails
    : [];
  if (details.length < minimumKnowledgeOnlyVarietyCount) {
    throw new Error(`${label}: expected at least ${minimumKnowledgeOnlyVarietyCount} knowledge-only varieties, found ${details.length}`);
  }
  if (Number(book?.coffeeKnowledgeMeta?.knowledgeOnlyVarietyCount) !== details.length) {
    throw new Error(`${label}: knowledge-only variety count metadata is inconsistent`);
  }
  for (const id of ["WCR-HP-ANACAFE-14", "WCR-HP-CATIMOR-129"]) {
    const detail = details.find((item) => String(item?.id ?? "") === id);
    if (!detail || detail.coreCode || !detail.canonicalNameEn) {
      throw new Error(`${label}: safe knowledge-only variety missing: ${id}`);
    }
    if (!Array.isArray(detail.sourceRefs) || detail.sourceRefs.length === 0) {
      throw new Error(`${label}: knowledge-only variety lacks sources: ${id}`);
    }
  }
}

function assertKnowledgeOnlyRuntime(book, label) {
  if (RECOGNITION_PIPELINE_VERSION !== requiredPipelineVersion) {
    throw new Error(`${label}: installed LuckyBean pipeline is ${RECOGNITION_PIPELINE_VERSION}, expected ${requiredPipelineVersion}`);
  }
  const document = recognitionDocumentFromText("VARIETY: Anacafe 14");
  const analysis = analyzeRecognitionDocument(document, book);
  const candidate = analysis?.parsed?.parseMetadata?.knowledgeOnlyVariety;
  const field = analysis?.fields?.find((item) => item.field === "varietyCode");
  if (analysis?.parsed?.varietyCode) {
    throw new Error(`${label}: knowledge-only variety fabricated QR/core code ${analysis.parsed.varietyCode}`);
  }
  if (candidate?.knowledgeId !== "WCR-HP-ANACAFE-14") {
    throw new Error(`${label}: Anacafe 14 did not resolve to the expected knowledge-only identity`);
  }
  if (candidate?.qrCoreCode !== null || candidate?.qrEligible !== false || candidate?.productionCoreApproved !== false) {
    throw new Error(`${label}: knowledge-only candidate incorrectly acquired QR/production eligibility`);
  }
  if (candidate?.manualConfirmationRequired !== true) {
    throw new Error(`${label}: knowledge-only candidate does not require manual confirmation`);
  }
  if (!Array.isArray(candidate?.sourceRefs) || candidate.sourceRefs.length === 0) {
    throw new Error(`${label}: knowledge-only runtime candidate lost source evidence`);
  }
  if (!field || field.resolved !== false || field.status !== "review") {
    throw new Error(`${label}: knowledge-only variety did not remain in recognition review`);
  }
}

const source = await fetchJson(codebookUrl);
for (const output of outputs) {
  const html = await readFile(output, "utf8");
  const label = output.replace(`${root}/`, "");
  assertHardenedBootstrap(html, label);
  const book = embeddedBook(html);
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
  assertEntityResolutionSafety(book, label);
  assertKnowledgeOnlySubset(book, label);
  assertKnowledgeOnlyRuntime(book, label);
  console.log(`${label}: Coffee Knowledge ${book.coffeeKnowledgeMeta.version} verified; aliases=${book.coffeeKnowledgeMeta.aliasesApplied}; blockedEntities=${book.coffeeKnowledgeMeta.blockedAutomaticEntityResolutionCount}; knowledgeOnlyVarieties=${book.coffeeKnowledgeMeta.knowledgeOnlyVarietyCount}; pipeline=${RECOGNITION_PIPELINE_VERSION}; runtimeMemory=true; localCacheFallback=true; QR indexes unchanged`);
}
