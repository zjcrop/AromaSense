import type { CoffeeFoundationGateway, FoundationBatchAiResult, FoundationFieldDecision } from "./sample-input-pipeline";

interface FoundationRuntime {
  buildRecognitionBook(input: Record<string, unknown>): unknown;
  resolveRecognitionValue(book: unknown, input: Record<string, unknown>): FoundationFieldDecision;
  validateAiEnrichmentResult(input: unknown): { ok: boolean; value?: FoundationBatchAiResult; errors?: readonly string[] };
  parseCoffeeDate(value: string, options: { field: string; locale: string; evidenceRefs: readonly string[] }): {
    rawValue: string; normalizedValue: string; canonicalDate?: string | null;
    status: FoundationFieldDecision["status"]; reason: string;
  };
}

const BOOK_CACHE_KEY = "aromasense.luckybean-recognition-book.v1";

function runtime(): FoundationRuntime | undefined {
  return (globalThis as typeof globalThis & { CoffeeFoundation?: FoundationRuntime }).CoffeeFoundation;
}

function readSourceBook(): Record<string, unknown> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(BOOK_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch { return undefined; }
}

export function createCoffeeFoundationGateway(cloudBaseUrl?: string, token?: () => Promise<string | undefined>): CoffeeFoundationGateway {
  const core = runtime();
  const source = readSourceBook();
  let book: unknown;
  if (core && source) {
    book = core.buildRecognitionBook({ codebook: source, lexicon: source.labelLexicon ?? {}, knowledge: source.coffeeKnowledge ?? null });
  }
  return {
    resolve(field, value, evidenceRef) {
      if (!core || !book) return { field, rawValue: value, normalizedValue: value, status: "review", reason: "foundation-runtime-unavailable", selected: null };
      if (["roastDate", "productionDate", "packDate", "bestBefore", "expiryDate"].includes(field)) {
        const decision = core.parseCoffeeDate(value, { field, locale: navigator.language || "zh-CN", evidenceRefs: [evidenceRef] });
        return {
          field, rawValue: decision.rawValue, normalizedValue: decision.canonicalDate || decision.normalizedValue,
          status: decision.status, reason: decision.reason,
          selected: decision.canonicalDate ? { canonicalId: `date:${decision.canonicalDate}`, display: decision.canonicalDate } : null
        };
      }
      return core.resolveRecognitionValue(book, { field, value, locale: navigator.language || "zh-CN", evidenceRefs: [evidenceRef] });
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
        if (!payload.ok || !payload.result || !core) return { ok: false, reason: payload.reason ?? "invalid-response" };
        const validation = core.validateAiEnrichmentResult(payload.result);
        return validation.ok && validation.value
          ? { ok: true, result: validation.value }
          : { ok: false, reason: "schema-invalid" };
      } catch { return { ok: false, reason: "network-error" }; }
    }
  };
}
