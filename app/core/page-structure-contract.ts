import type { RecognitionDictionaryHint, RecognitionLayoutHints, PageStructureEvidenceBlock } from "./recognition-evidence-harvester";

export const AI_PAGE_STRUCTURE_SCHEMA = "ai-page-structure-result/1.0" as const;

export type PageStructureField =
  | "label" | "country" | "region" | "entity" | "farm" | "station" | "producer" | "cooperative"
  | "variety" | "species" | "process" | "lot" | "grade" | "roast" | "roastDate" | "harvest"
  | "altitude" | "roaster" | "weight" | "flavorNotes";

export interface PageStructureFieldValue {
  field: PageStructureField;
  value: string;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface PageStructureExtraValue {
  field: "price" | "brewCategory" | "packageWeight" | "menuCategory";
  value: string;
  confidence: number;
  evidenceRefs: readonly string[];
}

export interface PageStructureSample {
  sampleRef: string;
  confidence: number;
  evidenceRefs: readonly string[];
  fields: readonly PageStructureFieldValue[];
  extras?: readonly PageStructureExtraValue[];
}

export interface PageStructureResult {
  schemaVersion: typeof AI_PAGE_STRUCTURE_SCHEMA;
  task: "structure-page";
  engine: string;
  model?: string | null;
  createdAt: string;
  inputFingerprint: string;
  samples: readonly PageStructureSample[];
  unassignedEvidence: readonly string[];
  policy: {
    authority: "advisory";
    mayInventFact: false;
    mayOverwriteFact: false;
  };
}

export interface PageStructureInput {
  fullText: string;
  blocks: readonly PageStructureEvidenceBlock[];
  layoutHints?: RecognitionLayoutHints;
}

export interface CoffeePageStructureGateway {
  dictionaryHints?(text: string, evidenceRef: string): readonly RecognitionDictionaryHint[];
  structurePage?(input: PageStructureInput): Promise<{ ok: boolean; result?: PageStructureResult; reason?: string }>;
}

export type PageStructureEvidenceValidation =
  | { ok: true }
  | { ok: false; reason: string };

function validConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function cleanRef(value: string): string {
  return value.trim();
}

function validateReferencedValue(
  value: PageStructureFieldValue | PageStructureExtraValue,
  sampleEvidence: ReadonlySet<string>,
  allowedEvidence: ReadonlySet<string>,
  sampleRef: string
): string | undefined {
  if (!value.value.trim()) return `empty-value:${sampleRef}:${value.field}`;
  if (!validConfidence(value.confidence)) return `invalid-field-confidence:${sampleRef}:${value.field}`;
  if (!value.evidenceRefs.length) return `field-without-evidence:${sampleRef}:${value.field}`;
  if (new Set(value.evidenceRefs.map(cleanRef)).size !== value.evidenceRefs.length) {
    return `duplicate-field-evidence:${sampleRef}:${value.field}`;
  }
  for (const rawRef of value.evidenceRefs) {
    const ref = cleanRef(rawRef);
    if (!ref || !allowedEvidence.has(ref)) return `unknown-field-evidence:${sampleRef}:${value.field}:${ref || "empty"}`;
    if (!sampleEvidence.has(ref)) return `field-evidence-outside-sample:${sampleRef}:${value.field}:${ref}`;
  }
  return undefined;
}

/**
 * Enforces the AromaSense side of the advisory whole-page AI contract.
 * Schema validation alone is insufficient: every AI fact must remain bound to
 * OCR evidence supplied for this exact page, and one evidence block cannot be
 * silently assigned to multiple coffee records.
 */
export function validatePageStructureEvidence(
  result: PageStructureResult,
  allowedEvidenceRefs: readonly string[]
): PageStructureEvidenceValidation {
  if (result.schemaVersion !== AI_PAGE_STRUCTURE_SCHEMA || result.task !== "structure-page") {
    return { ok: false, reason: "contract-version-mismatch" };
  }
  if (
    result.policy.authority !== "advisory"
    || result.policy.mayInventFact !== false
    || result.policy.mayOverwriteFact !== false
  ) {
    return { ok: false, reason: "unsafe-ai-policy" };
  }
  if (!result.inputFingerprint.trim()) return { ok: false, reason: "missing-input-fingerprint" };
  if (!result.samples.length) return { ok: false, reason: "no-structured-samples" };

  const allowedEvidence = new Set(allowedEvidenceRefs.map(cleanRef).filter(Boolean));
  const sampleRefs = new Set<string>();
  const assignedEvidence = new Set<string>();

  for (const sample of result.samples) {
    const sampleRef = cleanRef(sample.sampleRef);
    if (!sampleRef) return { ok: false, reason: "empty-sample-ref" };
    if (sampleRefs.has(sampleRef)) return { ok: false, reason: `duplicate-sample-ref:${sampleRef}` };
    sampleRefs.add(sampleRef);
    if (!validConfidence(sample.confidence)) return { ok: false, reason: `invalid-sample-confidence:${sampleRef}` };
    if (!sample.evidenceRefs.length) return { ok: false, reason: `sample-without-evidence:${sampleRef}` };

    const normalizedSampleEvidence = sample.evidenceRefs.map(cleanRef);
    if (new Set(normalizedSampleEvidence).size !== normalizedSampleEvidence.length) {
      return { ok: false, reason: `duplicate-sample-evidence:${sampleRef}` };
    }
    const sampleEvidence = new Set<string>();
    for (const ref of normalizedSampleEvidence) {
      if (!ref || !allowedEvidence.has(ref)) return { ok: false, reason: `unknown-sample-evidence:${sampleRef}:${ref || "empty"}` };
      if (assignedEvidence.has(ref)) return { ok: false, reason: `evidence-assigned-to-multiple-samples:${ref}` };
      sampleEvidence.add(ref);
      assignedEvidence.add(ref);
    }

    for (const field of sample.fields) {
      const reason = validateReferencedValue(field, sampleEvidence, allowedEvidence, sampleRef);
      if (reason) return { ok: false, reason };
    }
    for (const extra of sample.extras ?? []) {
      const reason = validateReferencedValue(extra, sampleEvidence, allowedEvidence, sampleRef);
      if (reason) return { ok: false, reason };
    }
  }

  const normalizedUnassigned = result.unassignedEvidence.map(cleanRef);
  if (new Set(normalizedUnassigned).size !== normalizedUnassigned.length) {
    return { ok: false, reason: "duplicate-unassigned-evidence" };
  }
  for (const ref of normalizedUnassigned) {
    if (!ref || !allowedEvidence.has(ref)) return { ok: false, reason: `unknown-unassigned-evidence:${ref || "empty"}` };
    if (assignedEvidence.has(ref)) return { ok: false, reason: `evidence-both-assigned-and-unassigned:${ref}` };
  }

  return { ok: true };
}
