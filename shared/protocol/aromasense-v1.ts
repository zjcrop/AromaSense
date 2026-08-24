export const PROTOCOL_VERSION = "aromasense-sync/1.0" as const;
export const TAXONOMY_VERSION = "sensory-stage/1.0" as const;

export const STAGE_IDS = [
  "preparation",
  "aroma",
  "high_temp",
  "mid_temp",
  "low_temp",
  "final"
] as const;

export type StageId = (typeof STAGE_IDS)[number];
export type RevisionKind = "checkpoint" | "final";

export interface SensoryObservation {
  observationId: string;
  sessionId: string;
  sampleId: string;
  stageId: StageId;
  fieldKey: string;
  value: unknown;
  dictionaryVersion: string;
  updatedAt: string;
}

export interface RevisionEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  revisionId: string;
  revisionKind: RevisionKind;
  sessionId: string;
  sampleId?: string;
  stageId?: StageId;
  sequence: number;
  createdAt: string;
  contentHash: string;
  payload: Record<string, unknown>;
}

export interface RevisionAck {
  ok: true;
  revisionId: string;
  contentHash: string;
  status: "created" | "already_present";
}

export interface RevisionConflict {
  ok: false;
  error: "REVISION_CONFLICT";
  revisionId: string;
  existingHash: string;
}
