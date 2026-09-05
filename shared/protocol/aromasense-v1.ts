export const PROTOCOL_VERSION = "aromasense-sync/1.0" as const;
export const TAXONOMY_VERSION = "sensory-flow/2.0" as const;

export const STAGE_IDS = [
  "aroma",
  "high_temp",
  "mid_temp",
  "low_temp",
  "flavor",
  "overall",
  "scoring"
] as const;

export const LEGACY_STAGE_IDS = ["preparation", "final"] as const;
export type FlowStepId = (typeof STAGE_IDS)[number];
export type LegacyStageId = (typeof LEGACY_STAGE_IDS)[number];
export type StageId = FlowStepId | LegacyStageId;

export function normalizeFlowStep(stageId: string): FlowStepId {
  if (stageId === "preparation") return "aroma";
  if (stageId === "final") return "flavor";
  if ((STAGE_IDS as readonly string[]).includes(stageId)) return stageId as FlowStepId;
  throw new Error(`UNKNOWN_FLOW_STEP:${stageId}`);
}
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
