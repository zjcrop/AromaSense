import { cuppingModeFromMetadata, type CuppingMode } from "./session-metadata";
import type { SubmissionBundle } from "./submission-bundle";
import type { CuppingRecordSnapshot } from "./session-record-service";
import { sampleIndexFromMetadata } from "./sample-batch-service";

export interface ComparisonBundle {
  schemaVersion: "aromasense-comparison/1.0";
  comparisonSubjectId: string;
  eventId: string;
  eventRevision: number;
  mode: CuppingMode;
  samples: Array<{
    eventSampleId: string;
    sampleCode: string;
    sampleIndex?: number;
    canonicalMetadata: Record<string, unknown>;
    observations: Array<{ flowStep: string; fieldKey: string; value: unknown }>;
  }>;
}

export interface ComparisonMappingEntry { localSampleId: string; peerSampleIndex: number; matchedBy: "eventSampleId" | "sampleCode" | "canonicalMetadata" | "globalSampleId" | "sampleIndex"; }
export interface ComparisonMapping { schemaVersion: "aromasense-comparison-mapping/1.0"; localSessionId: string; comparisonSubjectId: string; entries: ComparisonMappingEntry[]; }

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function normalized(value: unknown): string { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US"); }

function canonicalFingerprint(metadata: Record<string, unknown>): string {
  const canonical = object(metadata.canonical);
  const decisions = Array.isArray(canonical.decisions) ? canonical.decisions : [];
  const ids = decisions.flatMap((item) => {
    const row = object(item); const selected = object(row.selected);
    const id = normalized(selected.canonicalId ?? selected.coreCode);
    return id ? [`${normalized(row.field)}:${id}`] : [];
  }).sort();
  return ids.join("|");
}

export function comparisonBundleFromSubmission(bundle: SubmissionBundle, comparisonSubjectId: string): ComparisonBundle {
  const bindingByLocal = new Map(bundle.eventBindings.map((item) => [item.localSampleId, item] as const));
  return {
    schemaVersion: "aromasense-comparison/1.0", comparisonSubjectId,
    eventId: bundle.eventManifest.eventId, eventRevision: bundle.eventManifest.eventRevision,
    mode: cuppingModeFromMetadata(bundle.record.session.metadata),
    samples: bundle.record.samples.map((sample) => {
      const binding = bindingByLocal.get(sample.sampleId)!;
      const canonicalMetadata = object(sample.metadata.canonical);
      const globalSampleId = normalized(sample.metadata.globalSampleId);
      return {
        eventSampleId: binding.eventSampleId, sampleCode: binding.sampleCode, sampleIndex: binding.sampleIndex,
        canonicalMetadata: globalSampleId ? { ...canonicalMetadata, globalSampleId } : canonicalMetadata,
        observations: bundle.record.observations.filter((item) => item.sampleId === sample.sampleId).map((item) => ({ flowStep: item.stageId, fieldKey: item.fieldKey, value: item.value }))
      };
    })
  };
}

export function normalizeComparisonBundle(value: unknown): ComparisonBundle | undefined {
  const source = object(value);
  if (source.schemaVersion === "aromasense-comparison/1.0" && Array.isArray(source.samples)) return source as unknown as ComparisonBundle;
  if (source.schemaVersion === "aromasense-submission/1.0") {
    const bundle = source as unknown as SubmissionBundle;
    return comparisonBundleFromSubmission(bundle, String(source.comparisonSubjectId ?? source.contentHash ?? "peer"));
  }
  return undefined;
}

export function mapComparison(local: CuppingRecordSnapshot, peer: ComparisonBundle): ComparisonMapping {
  const strict = cuppingModeFromMetadata(local.session.metadata) !== "open" || peer.mode !== "open";
  const entries: ComparisonMappingEntry[] = [];
  const used = new Set<number>();
  const matched = new Set<string>();
  type Sample = CuppingRecordSnapshot["samples"][number];
  type PeerSample = ComparisonBundle["samples"][number];
  const strategies: Array<[ComparisonMappingEntry["matchedBy"], (sample: Sample) => string, (sample: PeerSample) => string]> = [
    ["eventSampleId", (item) => normalized(item.metadata.eventSampleId), (item) => normalized(item.eventSampleId)],
    ["sampleCode", (item) => normalized(item.metadata.sampleCode), (item) => normalized(item.sampleCode)]
  ];
  if (strict) strategies.push(["sampleIndex", (item) => String(sampleIndexFromMetadata(item.metadata) ?? ""), (item) => String(sampleIndexFromMetadata({ sampleIndex: item.sampleIndex }) ?? "")]);
  else strategies.push(
    ["canonicalMetadata", (item) => canonicalFingerprint(item.metadata), (item) => canonicalFingerprint({ canonical: item.canonicalMetadata })],
    ["globalSampleId", (item) => normalized(item.metadata.globalSampleId), (item) => normalized(item.canonicalMetadata.globalSampleId)]
  );
  // Apply each identity priority globally; ambiguous candidates remain unmatched.
  for (const [matchedBy, ownKey, peerKey] of strategies) {
    const candidates = local.samples.filter((sample) => !matched.has(sample.sampleId)).map((sample) => {
      const key = ownKey(sample);
      return { sample, indices: peer.samples.flatMap((item, index) => key && !used.has(index) && peerKey(item) === key ? [index] : []) };
    });
    const claims = new Map<number, number>();
    for (const candidate of candidates) for (const index of candidate.indices) claims.set(index, (claims.get(index) ?? 0) + 1);
    for (const { sample, indices } of candidates) {
      if (indices.length !== 1 || claims.get(indices[0]) !== 1) continue;
      used.add(indices[0]); matched.add(sample.sampleId);
      entries.push({ localSampleId: sample.sampleId, peerSampleIndex: indices[0], matchedBy });
    }
  }
  return { schemaVersion: "aromasense-comparison-mapping/1.0", localSessionId: local.session.sessionId, comparisonSubjectId: peer.comparisonSubjectId, entries };
}

const COMPARISON_CONTROL_FIELDS = new Set(["final_phase", "score_confirmed", "final_score_confirmed", "status", "stageStatus", "stage_status", "flowStatus", "displayOrder", "completedAt", "startedAt", "completionColor"]);
export function isComparisonField(fieldKey: string): boolean { return !COMPARISON_CONTROL_FIELDS.has(fieldKey) && !fieldKey.startsWith("blind_guess_") && !fieldKey.startsWith("ui_"); }

export function comparisonFieldKey(flowStep: string, fieldKey: string): string {
  const step = flowStep === "preparation" ? "aroma" : flowStep === "final"
    ? (["flavor_tags", "notes"].includes(fieldKey) ? "flavor" : "overall") : flowStep;
  return JSON.stringify([step, fieldKey]);
}

export interface ComparisonFieldView { flowStep: string; fieldKey: string; own: unknown; peer?: unknown; peerOnlyTags?: string[]; overlappingTags?: string[]; }

export function comparisonFields(local: CuppingRecordSnapshot, peer: ComparisonBundle, mapping: ComparisonMapping, localSampleId: string): ComparisonFieldView[] {
  const entry = mapping.entries.find((item) => item.localSampleId === localSampleId);
  if (!entry) return [];
  const own = local.observations.filter((item) => item.sampleId === localSampleId);
  const other = peer.samples[entry.peerSampleIndex]?.observations ?? [];
  const keys = [...new Set([...own.filter((item) => isComparisonField(item.fieldKey)).map((item) => comparisonFieldKey(item.stageId, item.fieldKey)), ...other.filter((item) => isComparisonField(item.fieldKey)).map((item) => comparisonFieldKey(item.flowStep, item.fieldKey))])];
  return keys.map((key) => {
    const [flowStep, fieldKey] = JSON.parse(key) as [string, string];
    const ownValue = own.find((item) => comparisonFieldKey(item.stageId, item.fieldKey) === key)?.value;
    const peerValue = other.find((item) => comparisonFieldKey(item.flowStep, item.fieldKey) === key)?.value;
    if (Array.isArray(ownValue) || Array.isArray(peerValue)) {
      const a = new Set(Array.isArray(ownValue) ? ownValue.map(String) : []); const b = new Set(Array.isArray(peerValue) ? peerValue.map(String) : []);
      return { flowStep, fieldKey, own: ownValue, peer: peerValue, overlappingTags: [...a].filter((item) => b.has(item)), peerOnlyTags: [...b].filter((item) => !a.has(item)) };
    }
    return { flowStep, fieldKey, own: ownValue, peer: peerValue };
  });
}
