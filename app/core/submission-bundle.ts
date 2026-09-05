import { STAGE_IDS } from "../../shared/protocol/aromasense-v1";
import type { CuppingRecordSnapshot } from "./session-record-service";
import { canonicalJson, sha256Hex } from "./revision-builder";
import { sampleIndexFromMetadata, type SampleRecord } from "./sample-batch-service";

export interface EventManifest {
  schemaVersion: "aromasense-event-manifest/1.0";
  eventId: string;
  eventRevision: number;
  name?: string;
  date: string;
  time: string;
  organizer: string;
  sampleCount: number;
  lowPrecisionLocation?: { latitude: number; longitude: number; accuracyKm: number };
  interfaces: { invite: string; qr: string; deepLink: string };
}

export interface EventBinding {
  eventId: string;
  eventRevision: number;
  eventSampleId: string;
  sampleCode: string;
  sampleIndex?: number;
  localSampleId: string;
}

export interface ProgressEnvelope {
  schemaVersion: "aromasense-progress/1.0";
  sessionId: string;
  samples: Array<{ sampleId: string; steps: Array<{ flowStep: string; status: string }> }>;
}

export interface SubmissionBundle {
  schemaVersion: "aromasense-submission/1.0";
  revision: number;
  contentHash: string;
  createdAt: string;
  eventManifest: EventManifest;
  eventBindings: EventBinding[];
  progress: ProgressEnvelope;
  record: CuppingRecordSnapshot;
}

export function eventManifestFromSubmission(value: unknown): EventManifest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== "aromasense-submission/1.0" || !root.eventManifest || typeof root.eventManifest !== "object" || Array.isArray(root.eventManifest)) return undefined;
  const manifest = root.eventManifest as Record<string, unknown>;
  if (manifest.schemaVersion !== "aromasense-event-manifest/1.0" || !String(manifest.eventId ?? "").trim()
    || !Number.isInteger(manifest.eventRevision) || Number(manifest.eventRevision) < 1
    || !/^\d{4}-\d{2}-\d{2}$/u.test(String(manifest.date ?? "")) || !/^\d{2}:\d{2}$/u.test(String(manifest.time ?? ""))
    || !String(manifest.organizer ?? "").trim() || !Number.isInteger(manifest.sampleCount) || Number(manifest.sampleCount) < 0) return undefined;
  return manifest as unknown as EventManifest;
}

function bindingForSample(sample: SampleRecord, eventId: string, eventRevision: number): EventBinding {
  const sampleIndex = sampleIndexFromMetadata(sample.metadata);
  const fallbackId = sampleIndex === undefined ? `local:${encodeURIComponent(sample.sampleId)}` : `sample:${sampleIndex + 1}`;
  return {
    eventId, eventRevision, localSampleId: sample.sampleId, sampleIndex,
    eventSampleId: String(sample.metadata.eventSampleId ?? "").trim() || `${eventId}:${fallbackId}`,
    sampleCode: String(sample.metadata.sampleCode ?? "").trim() || (sampleIndex === undefined ? `local:${sample.sampleId}` : `S${String(sampleIndex + 1).padStart(2, "0")}`)
  };
}

export async function buildSubmissionBundle(snapshot: CuppingRecordSnapshot, revision = 1): Promise<SubmissionBundle> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("INVALID_SUBMISSION_REVISION");
  const metadata = snapshot.session.metadata;
  const eventId = metadata.eventId?.trim() || `local:${snapshot.session.sessionId}`;
  const eventRevision = metadata.eventRevision ?? 1;
  const eventManifest: EventManifest = {
    schemaVersion: "aromasense-event-manifest/1.0", eventId, eventRevision,
    name: metadata.eventName || snapshot.session.title, date: metadata.date, time: metadata.time,
    organizer: metadata.organizer, sampleCount: snapshot.samples.length,
    lowPrecisionLocation: metadata.lowPrecisionLocation,
    interfaces: {
      invite: `aromasense://event/${encodeURIComponent(eventId)}/invite`,
      qr: `aromasense://event/${encodeURIComponent(eventId)}?revision=${eventRevision}`,
      deepLink: `https://aromasense.invalid/event/${encodeURIComponent(eventId)}?revision=${eventRevision}`
    }
  };
  const eventBindings = snapshot.samples.map((sample) => bindingForSample(sample, eventId, eventRevision));
  const progress: ProgressEnvelope = {
    schemaVersion: "aromasense-progress/1.0", sessionId: snapshot.session.sessionId,
    samples: snapshot.samples.map((sample) => ({ sampleId: sample.sampleId, steps: STAGE_IDS.map((flowStep) => ({
      flowStep, status: snapshot.stageStates.find((state) => state.sampleId === sample.sampleId && state.stageId === flowStep)?.status ?? "not_started"
    })) }))
  };
  const content = { schemaVersion: "aromasense-submission/1.0" as const, revision, createdAt: snapshot.exportedAt, eventManifest, eventBindings, progress, record: snapshot };
  const hashSource = { eventManifest, eventBindings, progress, record: { ...snapshot, exportedAt: undefined } };
  return { ...content, contentHash: await sha256Hex(canonicalJson(hashSource)) };
}

function csv(value: unknown): string {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const text = encoded === undefined ? "" : encoded;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function completeCsv(snapshot: CuppingRecordSnapshot, bundle: SubmissionBundle): string {
  const bindings = new Map(bundle.eventBindings.map((item) => [item.localSampleId, item] as const));
  const header = ["submissionRevision","contentHash","sessionId","sessionTitle","sessionMetadata","eventId","eventRevision","eventSampleId","sampleCode","sampleIndex","displayOrder","label","sampleMetadata","flowStep","stageStatus","fieldKey","value","dictionaryVersion","updatedAt"];
  const rows = snapshot.samples.flatMap((sample) => {
    const binding = bindings.get(sample.sampleId)!;
    const observations = snapshot.observations.filter((observation) => observation.sampleId === sample.sampleId);
    const source = observations.length ? observations : [undefined];
    return source.map((observation) => {
      const stageStatus = observation
        ? snapshot.stageStates.find((state) => state.sampleId === sample.sampleId && state.stageId === observation.stageId)?.status ?? "not_started"
        : "";
      return [bundle.revision,bundle.contentHash,snapshot.session.sessionId,snapshot.session.title ?? "",snapshot.session.metadata,binding.eventId,binding.eventRevision,binding.eventSampleId,binding.sampleCode,binding.sampleIndex,sample.displayNumber,sample.label ?? "",sample.metadata,observation?.stageId ?? "",stageStatus,observation?.fieldKey ?? "",observation?.value,observation?.dictionaryVersion ?? "",observation?.updatedAt ?? sample.updatedAt].map(csv).join(",");
    });
  });
  return `\uFEFF${header.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}
