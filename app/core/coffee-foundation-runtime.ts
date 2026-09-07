import type { CoffeeFoundationGateway, FoundationBatchAiResult, FoundationFieldDecision } from "./sample-input-pipeline";
import type { CoffeePageStructureGateway, PageStructureResult } from "./page-structure-contract";
import type { RecognitionDictionaryHint } from "./recognition-evidence-harvester";

interface FoundationRuntime {
  buildRecognitionBook(input: Record<string, unknown>): unknown;
  resolveRecognitionValue(book: unknown, input: Record<string, unknown>): FoundationFieldDecision;
  validateAiEnrichmentResult(input: unknown): { ok: boolean; value?: FoundationBatchAiResult; errors?: readonly string[] };
  validateAiPageStructureResult(input: unknown): { ok: boolean; value?: PageStructureResult; errors?: readonly string[] };
  parseCoffeeDate(value: string, options: { field: string; locale: string; evidenceRefs: readonly string[] }): {
    rawValue: string; normalizedValue: string; canonicalDate?: string | null;
    status: FoundationFieldDecision["status"]; reason: string;
  };
}

const BOOK_CACHE_KEY = "aromasense.luckybean-recognition-book.v1";
const HINT_FIELDS = ["country", "region", "entity", "variety", "process", "flavor"] as const;

type FoundationGlobal = typeof globalThis & {
  CoffeeFoundation?: FoundationRuntime;
  __AROMASENSE_RECOGNITION_BOOK__?: unknown;
};

function runtime(): FoundationRuntime | undefined {
  return (globalThis as FoundationGlobal).CoffeeFoundation;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readSourceBook(): Record<string, unknown> | undefined {
  const inMemory = object((globalThis as FoundationGlobal).__AROMASENSE_RECOGNITION_BOOK__);
  if (inMemory) return inMemory;
  try {
    const raw = globalThis.localStorage?.getItem(BOOK_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return object(parsed);
  } catch { return undefined; }
}

function hintTokens(value: string): string[] {
  const source = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!source) return [];
  const tokens = source.split(/[，,、；;|｜·•\t]+/u).map((item) => item.trim()).filter(Boolean);
  const spaceTokens = tokens.flatMap((item) => item.length <= 80 ? item.split(/\s{1,}/u).filter((part) => part.length >= 2) : []);
  return [...new Set([source, ...tokens, ...spaceTokens])].filter((item) => item.length >= 2 && item.length <= 120).slice(0, 10);
}

export function createCoffeeFoundationGateway(
  cloudBaseUrl?: string,
  token?: () => Promise<string | undefined>
): CoffeeFoundationGateway & CoffeePageStructureGateway {
  let core: FoundationRuntime | undefined;
  let book: unknown;
  let initialized = false;
  const hintCache = new Map<string, readonly RecognitionDictionaryHint[]>();

  const ensureRecognitionBook = (): { core?: FoundationRuntime; book?: unknown } => {
    if (!initialized) {
      initialized = true;
      core = runtime();
      const source = readSourceBook();
      if (core && source) {
        book = core.buildRecognitionBook({
          codebook: source,
          lexicon: source.labelLexicon ?? {},
          knowledge: source.coffeeKnowledge ?? null
        });
      }
    }
    return { core, book };
  };

  return {
    resolve(field, value, evidenceRef) {
      const ready = ensureRecognitionBook();
      if (!ready.core || !ready.book) return { field, rawValue: value, normalizedValue: value, status: "review", reason: "foundation-runtime-unavailable", selected: null };
      if (["roastDate", "productionDate", "packDate", "bestBefore", "expiryDate"].includes(field)) {
        const decision = ready.core.parseCoffeeDate(value, { field, locale: navigator.language || "zh-CN", evidenceRefs: [evidenceRef] });
        return {
          field, rawValue: decision.rawValue, normalizedValue: decision.canonicalDate || decision.normalizedValue,
          status: decision.status, reason: decision.reason,
          selected: decision.canonicalDate ? { canonicalId: `date:${decision.canonicalDate}`, display: decision.canonicalDate } : null
        };
      }
      return ready.core.resolveRecognitionValue(ready.book, { field, value, locale: navigator.language || "zh-CN", evidenceRefs: [evidenceRef] });
    },
    dictionaryHints(text, evidenceRef) {
      const cacheKey = text.normalize("NFKC").trim();
      const cached = hintCache.get(cacheKey);
      if (cached) return cached;
      const ready = ensureRecognitionBook();
      if (!ready.core || !ready.book) return [];
      const hints: RecognitionDictionaryHint[] = [];
      const seen = new Set<string>();
      for (const candidate of hintTokens(text)) {
        for (const field of HINT_FIELDS) {
          const decision = ready.core.resolveRecognitionValue(ready.book, {
            field, value: candidate, locale: navigator.language || "zh-CN", evidenceRefs: [evidenceRef]
          });
          if (!decision.selected || !["confirmed", "review"].includes(decision.status)) continue;
          const type = decision.field === "flavor" ? "flavorNotes" : decision.field;
          const canonical = decision.selected.display || decision.normalizedValue;
          const key = `${type}\u0000${canonical}\u0000${candidate}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hints.push({
            type,
            canonical,
            candidate,
            confidence: decision.status === "confirmed" ? 1 : 0.72
          });
          if (hints.length >= 8) break;
        }
        if (hints.length >= 8) break;
      }
      hintCache.set(cacheKey, hints);
      return hints;
    },
    async enrichBatch(rows) {
      if (rows.length < 2) return { ok: false, reason: "minimum-two-samples" };
      if (!cloudBaseUrl || !navigator.onLine) return { ok: false, reason: "offline" };
      try {
        const authToken = await token?.();
        if (!authToken) return { ok: false, reason: "authentication-unavailable" };
        const response = await fetch(`${cloudBaseUrl.replace(/\/$/u, "")}/api/v1/ai/enrich-samples`, {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${authToken}` }, body: JSON.stringify({ samples: rows })
        });
        if (!response.ok) return { ok: false, reason: `http-${response.status}` };
        const payload = await response.json() as { ok?: boolean; result?: FoundationBatchAiResult; reason?: string };
        const validationCore = runtime();
        if (!payload.ok || !payload.result || !validationCore) return { ok: false, reason: payload.reason ?? "invalid-response" };
        const validation = validationCore.validateAiEnrichmentResult(payload.result);
        return validation.ok && validation.value
          ? { ok: true, result: validation.value }
          : { ok: false, reason: "schema-invalid" };
      } catch { return { ok: false, reason: "network-error" }; }
    },
    async structurePage(input) {
      if (input.blocks.length < 2) return { ok: false, reason: "insufficient-page-evidence" };
      if (!cloudBaseUrl || !navigator.onLine) return { ok: false, reason: "offline" };
      try {
        const authToken = await token?.();
        if (!authToken) return { ok: false, reason: "authentication-unavailable" };
        const response = await fetch(`${cloudBaseUrl.replace(/\/$/u, "")}/api/v1/ai/structure-recognition-page`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${authToken}` },
          body: JSON.stringify(input)
        });
        if (!response.ok) return { ok: false, reason: `http-${response.status}` };
        const payload = await response.json() as { ok?: boolean; result?: PageStructureResult; reason?: string };
        const validationCore = runtime();
        if (!payload.ok || !payload.result || !validationCore?.validateAiPageStructureResult) {
          return { ok: false, reason: payload.reason ?? "invalid-response" };
        }
        const validation = validationCore.validateAiPageStructureResult(payload.result);
        return validation.ok && validation.value
          ? { ok: true, result: validation.value }
          : { ok: false, reason: "schema-invalid" };
      } catch { return { ok: false, reason: "network-error" }; }
    }
  };
}
