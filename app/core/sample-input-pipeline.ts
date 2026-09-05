import type { ImportBundle, ImportSampleDraft } from "./import-bundle";

export type InputValidationState = "valid" | "review" | "invalid";

export interface InputValidationIssue {
  field: string;
  code: string;
  severity: "review" | "error";
}

export interface InputValidationResult {
  state: InputValidationState;
  marker: "" | "?" | "!";
  issues: readonly InputValidationIssue[];
}

export interface FoundationFieldDecision {
  field: string;
  rawValue: string;
  normalizedValue: string;
  status: "confirmed" | "review" | "unknown" | "conflict" | "invalid";
  reason: string;
  selected?: { canonicalId?: string | null; coreCode?: string | null; display?: string } | null;
}

export interface FoundationAiCandidate {
  field: string;
  value: unknown;
  canonicalId?: string | null;
  confidence: number;
  status: "candidate" | "review" | "rejected" | "confirmed";
  evidenceRefs: readonly string[];
}

export interface FoundationBatchAiResult {
  schemaVersion: "ai-enrichment-result/1.0";
  candidates: readonly FoundationAiCandidate[];
  policy?: { authority?: string; mayOverwriteFact?: boolean };
}

export interface CoffeeFoundationGateway {
  resolve(field: string, value: string, evidenceRef: string): FoundationFieldDecision;
  enrichBatch?(rows: readonly string[]): Promise<{ ok: boolean; result?: FoundationBatchAiResult; reason?: string }>;
}

const DATE_KEYS = new Set(["roastDate", "productionDate", "packDate", "bestBefore", "expiryDate"]);
const CANONICAL_KEYS = new Set(["country", "origin", "region", "farm", "station", "producer", "cooperative", "variety", "species", "process", "flavorNotes", "aroma", ...DATE_KEYS]);
const AI_FIELDS = new Set(["label", "country", "region", "entity", "farm", "station", "producer", "cooperative", "variety", "species", "process", "lot", "grade", "roast", "roastDate", "harvest", "altitude", "roaster", "weight", "flavorNotes"]);

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function validateSampleInput(sample: Pick<ImportSampleDraft, "label" | "metadata">): InputValidationResult {
  const issues: InputValidationIssue[] = [];
  if (!text(sample.label) || /^待确认样品\s+\d+$/u.test(sample.label)) issues.push({ field: "label", code: "missing-label", severity: "error" });
  const canonical = object(sample.metadata.canonical);
  const decisions = Array.isArray(canonical?.decisions) ? canonical.decisions as FoundationFieldDecision[] : [];
  for (const decision of decisions) {
    if (decision.status === "conflict" || decision.status === "invalid") issues.push({ field: decision.field, code: decision.reason, severity: "error" });
    else if (decision.status === "review" || decision.status === "unknown") issues.push({ field: decision.field, code: decision.reason, severity: "review" });
  }
  for (const key of DATE_KEYS) {
    const value = text(sample.metadata[key]);
    if (value && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) issues.push({ field: key, code: "date-requires-confirmation", severity: "review" });
  }
  const altitude = text(sample.metadata.altitude);
  if (altitude && !/\d{3,4}(?:\s*[-–—~至]\s*\d{3,4})?\s*(?:m|米)?/iu.test(altitude)) issues.push({ field: "altitude", code: "invalid-altitude", severity: "review" });
  const state: InputValidationState = issues.some((item) => item.severity === "error") ? "invalid" : issues.length ? "review" : "valid";
  return { state, marker: state === "invalid" ? "!" : state === "review" ? "?" : "", issues };
}

function applyAiCandidates(sample: ImportSampleDraft, candidates: readonly FoundationAiCandidate[], evidenceRef: string): ImportSampleDraft {
  const metadata = { ...sample.metadata };
  const accepted: FoundationAiCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.evidenceRefs.includes(evidenceRef) || candidate.status === "rejected" || candidate.confidence < 0.5) continue;
    const key = candidate.field === "entity" ? "farm" : candidate.field;
    if (!AI_FIELDS.has(candidate.field) || text(metadata[key])) continue;
    if (key === "label") continue;
    if (typeof candidate.value !== "string" || !candidate.value.trim()) continue;
    metadata[key] = candidate.value.trim();
    accepted.push(candidate);
  }
  if (accepted.length) metadata.aiEnrichment = { schemaVersion: "ai-enrichment-result/1.0", authority: "advisory", candidates: accepted };
  return { ...sample, metadata, requiresReview: sample.requiresReview || accepted.length > 0 };
}

/** Rebuild decisions from the current fields so edits cannot retain stale validation. */
export function canonicalizeSampleInput(
  original: ImportSampleDraft,
  gateway: CoffeeFoundationGateway | undefined,
  evidenceRef: string
): ImportSampleDraft {
  const sample = { ...original, metadata: { ...original.metadata } };
  const decisions: FoundationFieldDecision[] = [];
  for (const [field, value] of Object.entries(sample.metadata)) {
    const normalized = text(value);
    if (!normalized || !CANONICAL_KEYS.has(field)) continue;
    decisions.push(gateway
      ? gateway.resolve(field, normalized, evidenceRef)
      : { field, rawValue: normalized, normalizedValue: normalized, status: "review", reason: "foundation-runtime-unavailable", selected: null });
  }
  sample.metadata.canonical = {
    schemaVersion: "coffee-canonical-record/1.0",
    foundationContract: "coffee-foundation/1.0",
    decisions
  };
  const validation = validateSampleInput(sample);
  sample.metadata.inputValidation = validation;
  sample.requiresReview = validation.state !== "valid";
  return sample;
}

/**
 * Final human confirmation is authoritative for the values visible in the review
 * form. Recognition/Foundation conflict remains in the audit trail, but may not
 * make a reviewed row impossible to finish. This never invents a canonical ID or
 * core code: unresolved values are confirmed as user-entered display values only.
 */
export function confirmSampleInput(
  original: ImportSampleDraft,
  gateway: CoffeeFoundationGateway | undefined,
  evidenceRef: string,
  confirmedAt: string
): ImportSampleDraft {
  const sample = canonicalizeSampleInput(original, gateway, evidenceRef);
  const canonical = object(sample.metadata.canonical) ?? {};
  const decisions = Array.isArray(canonical.decisions) ? canonical.decisions as FoundationFieldDecision[] : [];
  const overrides: Array<Record<string, unknown>> = [];
  const confirmedDecisions = decisions.map((decision) => {
    if (decision.status === "confirmed") return decision;
    const value = text(sample.metadata[decision.field]) || text(decision.normalizedValue) || text(decision.rawValue);
    if (!value) return decision;
    overrides.push({
      field: decision.field,
      previousStatus: decision.status,
      previousReason: decision.reason,
      rawValue: decision.rawValue,
      normalizedValue: decision.normalizedValue,
      confirmedValue: value,
      confirmedAt
    });
    return {
      ...decision,
      normalizedValue: value,
      status: "confirmed" as const,
      reason: "user-confirmed-override",
      selected: decision.selected?.canonicalId || decision.selected?.coreCode
        ? decision.selected
        : { display: value, canonicalId: null, coreCode: null }
    };
  });
  sample.metadata.canonical = {
    ...canonical,
    decisions: confirmedDecisions,
    ...(overrides.length ? { manualOverrides: overrides } : {}),
    userConfirmedAt: confirmedAt
  };
  const validation = validateSampleInput(sample);
  sample.metadata.inputValidation = validation;
  sample.requiresReview = validation.state !== "valid";
  return sample;
}

export async function canonicalizeAndValidateImportBundle(bundle: ImportBundle, gateway: CoffeeFoundationGateway): Promise<ImportBundle> {
  const sourceRows = bundle.sessions.flatMap((session) => session.samples.map((sample) => sample.rawText ?? sample.label));
  const ai = sourceRows.length >= 2 && gateway.enrichBatch ? await gateway.enrichBatch(sourceRows) : { ok: false, reason: "minimum-two-samples" };
  const aiValid = ai.ok && ai.result?.schemaVersion === "ai-enrichment-result/1.0"
    && ai.result.policy?.authority === "advisory" && ai.result.policy?.mayOverwriteFact === false;
  let globalIndex = 0;
  return {
    ...bundle,
    sessions: bundle.sessions.map((session) => ({
      ...session,
      samples: session.samples.map((original) => {
        globalIndex += 1;
        const evidenceRef = `sample:${globalIndex}`;
        const sample = aiValid ? applyAiCandidates(original, ai.result!.candidates, evidenceRef) : original;
        return canonicalizeSampleInput(sample, gateway, evidenceRef);
      })
    })),
    warnings: [...bundle.warnings, ...(sourceRows.length >= 2 && !aiValid ? ["AI 增强暂不可用，已保存本地解析结果"] : [])]
  };
}