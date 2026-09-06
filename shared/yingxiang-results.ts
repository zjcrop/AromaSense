import { STAGE_IDS } from "./protocol/aromasense-v1";
import { buildSubmissionBundle, type SubmissionBundle } from "../app/core/submission-bundle";
import { SENSORY_FIELDS_V1 } from "../app/core/sensory-dictionary-v1";

export interface ResultSample { eventSampleId: string; sampleCode: string; }
export interface CalibrationMapping { groupId: string; canonicalSampleId: string; eventSampleIds: string[]; revealPolicy: "after_event" | "organizer_only"; }
export interface NumericSummary { count: number; mean: number; sd: number | null; min: number; max: number; }
export interface ResultMetric extends NumericSummary { eventSampleId: string; sampleCode: string; stageId: string; fieldKey: string; label: string; }
export interface CalibrationMetric extends NumericSummary { groupId: string; canonicalSampleId: string; participantId: string; displayName: string; stageId: string; fieldKey: string; label: string; expectedRepeats: number; offsetFromPeers: number | null; }
export interface CollectedResult { participantId: string; displayName: string; bundle: SubmissionBundle; }
export interface YingxiangResults { submissions: number; metrics: ResultMetric[]; calibration: CalibrationMetric[]; }

const qualityLabels: Record<string, string> = { quality_flavor: "风味", quality_aftertaste: "余韵", quality_acidity: "酸质", quality_sweetness: "甜感", quality_body: "口感", quality_clean: "干净度", quality_uniformity: "一致性", quality_balance: "平衡" };
export function resultField(key: string, stage: string): { label: string; min: number; max: number; step: number } | undefined {
  if (stage === "overall" && qualityLabels[key]) return { label: qualityLabels[key], min: 1, max: 9, step: 1 };
  const field = SENSORY_FIELDS_V1.find((f) => f.key === key && (f.stages as readonly string[]).includes(stage));
  return field && (field.valueKind === "score" || field.valueKind === "intensity") ? { label: field.label, min: field.min!, max: field.max!, step: field.step! } : undefined;
}
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function fail(): never { throw new Error("YINGXIANG_SUBMISSION_INVALID"); }

/** Rebuild the signed content from the actual record; never trust supplied bindings or a client hash alone. */
export async function validateYingxiangSubmission(value: unknown, eventId: string, revision: number, samples: readonly ResultSample[]): Promise<SubmissionBundle> {
  if (!object(value) || value.schemaVersion !== "aromasense-submission/1.0" || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash) || !object(value.record)) fail();
  const r = value.record;
  if (r.version !== "AromaSense-B0.2.a" || !object(r.session) || !object(r.session.metadata) || typeof r.session.sessionId !== "string"
    || !r.session.sessionId || r.session.sessionId.length > 128 || !["completed", "archived"].includes(String(r.session.status))
    || r.session.metadata.eventId !== eventId || r.session.metadata.eventRevision !== revision
    || typeof r.exportedAt !== "string" || !Number.isFinite(Date.parse(r.exportedAt))
    || !Array.isArray(r.samples) || r.samples.length !== samples.length || !Array.isArray(r.observations) || r.observations.length > 60000
    || !Array.isArray(r.stageStates) || r.stageStates.length > samples.length * STAGE_IDS.length) fail();
  const ids = new Set<string>(); const slots = new Set<string>(); const allowed = new Map(samples.map(s => [s.eventSampleId, s.sampleCode]));
  for (const s of r.samples) {
    if (!object(s) || typeof s.sampleId !== "string" || !s.sampleId || ids.has(s.sampleId) || s.sessionId !== r.session.sessionId
      || !object(s.metadata) || typeof s.metadata.eventSampleId !== "string" || slots.has(s.metadata.eventSampleId)
      || allowed.get(s.metadata.eventSampleId) !== s.metadata.sampleCode) fail();
    ids.add(s.sampleId); slots.add(s.metadata.eventSampleId);
  }
  const keys = new Set<string>(); const confirmed = new Set<string>();
  for (const o of r.observations) {
    if (!object(o) || typeof o.sampleId !== "string" || !ids.has(o.sampleId) || o.sessionId !== r.session.sessionId
      || !(STAGE_IDS as readonly unknown[]).includes(o.stageId) || typeof o.fieldKey !== "string" || !o.fieldKey || o.fieldKey.length > 128) fail();
    const key = JSON.stringify([o.sampleId,o.stageId,o.fieldKey]); if (keys.has(key)) fail(); keys.add(key);
    const field = resultField(o.fieldKey, String(o.stageId));
    if (field && (typeof o.value !== "number" || !Number.isFinite(o.value) || o.value < field.min || o.value > field.max
      || Math.abs((o.value - field.min) / field.step - Math.round((o.value - field.min) / field.step)) > 1e-9)) fail();
    if (o.stageId === "scoring" && o.fieldKey === "score_confirmed" && o.value === true) confirmed.add(o.sampleId);
  }
  // Matches AromaSense's explicit final-score confirmation gate; missing earlier fields remain missing.
  if (confirmed.size !== ids.size) throw new Error("YINGXIANG_FINAL_SCORES_REQUIRED");
  const stages = new Set<string>();
  for (const s of r.stageStates) {
    if (!object(s) || typeof s.sampleId !== "string" || !ids.has(s.sampleId) || s.sessionId !== r.session.sessionId
      || !(STAGE_IDS as readonly unknown[]).includes(s.stageId) || !["not_started","active","completed"].includes(String(s.status))) fail();
    const key = JSON.stringify([s.sampleId,s.stageId]); if (stages.has(key)) fail(); stages.add(key);
  }
  const bundle = value as unknown as SubmissionBundle;
  const rebuilt = await buildSubmissionBundle(bundle.record, bundle.revision);
  if (rebuilt.contentHash !== bundle.contentHash || JSON.stringify(rebuilt.eventBindings) !== JSON.stringify(bundle.eventBindings)
    || JSON.stringify(rebuilt.eventManifest) !== JSON.stringify(bundle.eventManifest) || JSON.stringify(rebuilt.progress) !== JSON.stringify(bundle.progress)) {
    throw new Error("YINGXIANG_SUBMISSION_HASH_MISMATCH");
  }
  return rebuilt;
}

export function summarizeNumbers(values: readonly number[]): NumericSummary {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error("YINGXIANG_STAT_VALUES_INVALID");
  const mean = values.reduce((a,b) => a+b,0)/values.length;
  return { count: values.length, mean, sd: values.length > 1 ? Math.sqrt(values.reduce((a,b) => a+(b-mean)**2,0)/(values.length-1)) : null, min: Math.min(...values), max: Math.max(...values) };
}

/** Latest submission per participant only. Match stable slots and stage+field, never display order. */
export function aggregateYingxiangResults(rows: readonly CollectedResult[], samples: readonly ResultSample[], groups: readonly CalibrationMapping[]): YingxiangResults {
  const latest = new Map<string, CollectedResult>();
  for (const row of rows) if (!latest.has(row.participantId) || latest.get(row.participantId)!.bundle.revision < row.bundle.revision) latest.set(row.participantId,row);
  const cells = new Map<string, { slot: string; stage: string; field: string; label: string; values: number[] }>();
  const repeats: CalibrationMetric[] = [];
  for (const row of latest.values()) {
    const bindings = new Map(row.bundle.eventBindings.map(b => [b.localSampleId,b.eventSampleId]));
    const own = new Map<string, { stage: string; field: string; label: string; values: Map<string,number> }>();
    for (const o of row.bundle.record.observations) {
      const field = resultField(o.fieldKey,o.stageId); const slot = bindings.get(o.sampleId);
      if (!field || !slot || typeof o.value !== "number" || !Number.isFinite(o.value)) continue;
      const key = JSON.stringify([slot,o.stageId,o.fieldKey]);
      const cell = cells.get(key) ?? { slot,stage:o.stageId,field:o.fieldKey,label:field.label,values:[] };
      cell.values.push(o.value); cells.set(key,cell);
      const k = JSON.stringify([o.stageId,o.fieldKey]); const repeat = own.get(k) ?? { stage:o.stageId,field:o.fieldKey,label:field.label,values:new Map() };
      repeat.values.set(slot,o.value); own.set(k,repeat);
    }
    for (const group of groups) for (const v of own.values()) {
      const values = group.eventSampleIds.flatMap(id => v.values.has(id) ? [v.values.get(id)!] : []);
      if (values.length < 2) continue;
      repeats.push({ groupId:group.groupId,canonicalSampleId:group.canonicalSampleId,participantId:row.participantId,displayName:row.displayName,stageId:v.stage,fieldKey:v.field,label:v.label,expectedRepeats:group.eventSampleIds.length,...summarizeNumbers(values),offsetFromPeers:null });
    }
  }
  for (const metric of repeats) {
    const peers = repeats.filter(r => r.groupId === metric.groupId && r.stageId === metric.stageId && r.fieldKey === metric.fieldKey && r.participantId !== metric.participantId && r.count === r.expectedRepeats);
    if (peers.length && metric.count === metric.expectedRepeats) metric.offsetFromPeers = metric.mean - summarizeNumbers(peers.map(p => p.mean)).mean;
  }
  const codes = new Map(samples.map(s => [s.eventSampleId,s.sampleCode]));
  return { submissions:latest.size, metrics:[...cells.values()].map(c => ({ eventSampleId:c.slot,sampleCode:codes.get(c.slot) ?? c.slot,stageId:c.stage,fieldKey:c.field,label:c.label,...summarizeNumbers(c.values) })),calibration:repeats };
}
