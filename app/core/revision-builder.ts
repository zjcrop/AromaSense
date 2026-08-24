import {
  PROTOCOL_VERSION,
  type RevisionEnvelope,
  type RevisionKind,
  type StageId
} from "../../shared/protocol/aromasense-v1";

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      target[key] = sortForCanonicalJson(source[key]);
    }
    return target;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface BuildRevisionInput {
  revisionId: string;
  revisionKind: RevisionKind;
  sessionId: string;
  sampleId?: string;
  stageId?: StageId;
  sequence: number;
  createdAt: string;
  payload: Record<string, unknown>;
}

export async function buildRevision(input: BuildRevisionInput): Promise<RevisionEnvelope> {
  const hashSource = canonicalJson({
    protocolVersion: PROTOCOL_VERSION,
    revisionKind: input.revisionKind,
    sessionId: input.sessionId,
    sampleId: input.sampleId ?? null,
    stageId: input.stageId ?? null,
    sequence: input.sequence,
    createdAt: input.createdAt,
    payload: input.payload
  });

  return {
    protocolVersion: PROTOCOL_VERSION,
    revisionId: input.revisionId,
    revisionKind: input.revisionKind,
    sessionId: input.sessionId,
    sampleId: input.sampleId,
    stageId: input.stageId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    contentHash: await sha256Hex(hashSource),
    payload: input.payload
  };
}
