import type {
  RevisionAck,
  RevisionConflict,
  RevisionEnvelope
} from "../../shared/protocol/aromasense-v1";

export type UploadRevisionResult = RevisionAck | RevisionConflict;

export interface SyncRepository {
  uploadRevision(revision: RevisionEnvelope): Promise<UploadRevisionResult>;
  getRevision(revisionId: string): Promise<RevisionEnvelope | null>;
}

export class CloudflareSyncRepository implements SyncRepository {
  constructor(private readonly baseUrl: string) {}

  async uploadRevision(revision: RevisionEnvelope): Promise<UploadRevisionResult> {
    const response = await fetch(`${this.baseUrl}/api/v1/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(revision)
    });

    const body = (await response.json()) as UploadRevisionResult | { ok: false; error: string };
    if (response.status === 409 && "error" in body && body.error === "REVISION_CONFLICT") {
      return body as RevisionConflict;
    }
    if (!response.ok) {
      throw new Error(`SYNC_HTTP_${response.status}:${"error" in body ? body.error : "UNKNOWN"}`);
    }
    return body as RevisionAck;
  }

  async getRevision(revisionId: string): Promise<RevisionEnvelope | null> {
    const response = await fetch(`${this.baseUrl}/api/v1/revisions/${encodeURIComponent(revisionId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`SYNC_HTTP_${response.status}`);
    const body = (await response.json()) as { ok: true; revision: Record<string, unknown> };
    const row = body.revision;
    return {
      protocolVersion: row.protocol_version as RevisionEnvelope["protocolVersion"],
      revisionId: row.revision_id as string,
      revisionKind: row.revision_kind as RevisionEnvelope["revisionKind"],
      sessionId: row.session_id as string,
      sampleId: (row.sample_id as string | null) ?? undefined,
      stageId: (row.stage_id as RevisionEnvelope["stageId"] | null) ?? undefined,
      sequence: row.sequence as number,
      createdAt: row.created_at as string,
      contentHash: row.content_hash as string,
      payload: JSON.parse(row.payload_json as string) as Record<string, unknown>
    };
  }
}
