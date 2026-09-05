import { cuppingModeFromMetadata, type CuppingMode } from "./session-metadata";
import type { SubmissionBundle } from "./submission-bundle";
import type { CuppingRecordSnapshot } from "./session-record-service";

export interface ComparisonBundle {
  schemaVersion: "aromasense-comparison/1.0";
  comparisonSubjectId: string;
  eventId: string;
  eventRevision: number;
  mode: CuppingMode;
  samples: Array<{
    eventSampleId: string;
    sampleCode: string;
    sampleIndex: number;
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
  for (const sample of local.samples) {
    const eventSampleId = normalized(sample.metadata.eventSampleId);
    const sampleCode = normalized(sample.metadata.sampleCode);
    const storedSampleIndex = Number(sample.metadata.sampleIndex);
    const sampleIndex = Number.isInteger(storedSampleIndex) && storedSampleIndex >= 0
      ? storedSampleIndex
      : local.samples.findIndex((item) => item.sampleId === sample.sampleId);
    const canonical = canonicalFingerprint(sample.metadata);
    const globalSampleId = normalized(sample.metadata.globalSampleId);
    const candidates: Array<[ComparisonMappingEntry["matchedBy"], (item: ComparisonBundle["samples"][number]) => boolean]> = [
      ["eventSampleId", (item) => Boolean(eventSampleId) && normalized(item.eventSampleId) === eventSampleId],
      ["sampleCode", (item) => Boolean(sampleCode) && normalized(item.sampleCode) === sampleCode]
    ];
    if (strict) candidates.push(["sampleIndex", (item) => item.sampleIndex === sampleIndex]);
    else {
      candidates.push(["canonicalMetadata", (item) => Boolean(canonical) && canonicalFingerprint({ canonical: item.canonicalMetadata }) === canonical]);
      candidates.push(["globalSampleId", (item) => Boolean(globalSampleId) && normalized(item.canonicalMetadata.globalSampleId) === globalSampleId]);
    }
    for (const [matchedBy, predicate] of candidates) {
      const index = peer.samples.findIndex((item, peerIndex) => !used.has(peerIndex) && predicate(item));
      if (index < 0) continue;
      used.add(index); entries.push({ localSampleId: sample.sampleId, peerSampleIndex: index, matchedBy }); break;
    }
  }
  return { schemaVersion: "aromasense-comparison-mapping/1.0", localSessionId: local.session.sessionId, comparisonSubjectId: peer.comparisonSubjectId, entries };
}

export interface ComparisonFieldView { fieldKey: string; own: unknown; peer?: unknown; peerOnlyTags?: string[]; overlappingTags?: string[]; }

export function comparisonFields(local: CuppingRecordSnapshot, peer: ComparisonBundle, mapping: ComparisonMapping, localSampleId: string): ComparisonFieldView[] {
  const entry = mapping.entries.find((item) => item.localSampleId === localSampleId);
  if (!entry) return [];
  const own = local.observations.filter((item) => item.sampleId === localSampleId);
  const other = peer.samples[entry.peerSampleIndex]?.observations ?? [];
  const keys = [...new Set([...own.map((item) => item.fieldKey), ...other.map((item) => item.fieldKey)])]
    .filter((key) => !["final_phase", "score_confirmed"].includes(key));
  return keys.map((fieldKey) => {
    const ownValue = own.find((item) => item.fieldKey === fieldKey)?.value;
    const peerValue = other.find((item) => item.fieldKey === fieldKey)?.value;
    if (Array.isArray(ownValue) || Array.isArray(peerValue)) {
      const a = new Set(Array.isArray(ownValue) ? ownValue.map(String) : []); const b = new Set(Array.isArray(peerValue) ? peerValue.map(String) : []);
      return { fieldKey, own: ownValue, peer: peerValue, overlappingTags: [...a].filter((item) => b.has(item)), peerOnlyTags: [...b].filter((item) => !a.has(item)) };
    }
    return { fieldKey, own: ownValue, peer: peerValue };
  });
}
