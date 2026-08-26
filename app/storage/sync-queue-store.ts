import type { RevisionEnvelope } from "../../shared/protocol/aromasense-v1";
import type { SQLiteDriver } from "./local-cupping-repository";

export type SyncQueueStatus = "pending" | "uploading" | "synced" | "failed" | "conflict";

export interface PendingRevision {
  queueId: string;
  revision: RevisionEnvelope;
  status: SyncQueueStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  lastError?: string;
}

interface QueueRow {
  queue_id: string;
  status: SyncQueueStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  revision_id: string;
  session_id: string;
  sample_id: string | null;
  stage_id: RevisionEnvelope["stageId"] | null;
  revision_kind: RevisionEnvelope["revisionKind"];
  sequence: number;
  protocol_version: RevisionEnvelope["protocolVersion"];
  content_hash: string;
  payload_json: string;
  created_at: string;
}

function fromRow(row: QueueRow): PendingRevision {
  return {
    queueId: row.queue_id,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    lastError: row.last_error ?? undefined,
    revision: {
      protocolVersion: row.protocol_version,
      revisionId: row.revision_id,
      revisionKind: row.revision_kind,
      sessionId: row.session_id,
      sampleId: row.sample_id ?? undefined,
      stageId: row.stage_id ?? undefined,
      sequence: row.sequence,
      createdAt: row.created_at,
      contentHash: row.content_hash,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>
    }
  };
}

const QUEUE_SELECT = `SELECT q.queue_id, q.status, q.attempt_count, q.next_attempt_at, q.last_error,
  r.revision_id, r.session_id, r.sample_id, r.stage_id, r.revision_kind,
  r.sequence, r.protocol_version, r.content_hash, r.payload_json, r.created_at
  FROM sync_queue q JOIN revisions r ON r.revision_id = q.revision_id`;

export class SyncQueueStore {
  constructor(private readonly db: SQLiteDriver) {}

  async enqueue(revision: RevisionEnvelope, queueId: string, now: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT OR IGNORE INTO revisions (revision_id, session_id, sample_id, stage_id, revision_kind, sequence,
          protocol_version, content_hash, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [revision.revisionId, revision.sessionId, revision.sampleId ?? null, revision.stageId ?? null, revision.revisionKind,
          revision.sequence, revision.protocolVersion, revision.contentHash, JSON.stringify(revision.payload), revision.createdAt]
      );
      const existing = await this.db.get<{ content_hash: string }>(`SELECT content_hash FROM revisions WHERE revision_id = ?`, [revision.revisionId]);
      if (!existing || existing.content_hash !== revision.contentHash) throw new Error(`LOCAL_REVISION_CONFLICT:${revision.revisionId}`);
      await this.db.run(
        `INSERT INTO sync_queue (queue_id, revision_id, status, attempt_count, updated_at)
         VALUES (?, ?, 'pending', 0, ?) ON CONFLICT(revision_id) DO NOTHING`,
        [queueId, revision.revisionId, now]
      );
    });
  }

  async claimReady(now: string, sessionIds?: readonly string[]): Promise<PendingRevision | undefined> {
    return this.db.transaction(async () => {
      const ids = [...new Set((sessionIds ?? []).filter(Boolean))];
      const sessionClause = ids.length ? ` AND r.session_id IN (${ids.map(() => "?").join(",")})` : "";
      const row = await this.db.get<QueueRow>(
        `${QUEUE_SELECT}
         WHERE q.status IN ('pending','failed')
           AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= ?)${sessionClause}
         ORDER BY r.sequence ASC LIMIT 1`,
        [now, ...ids]
      );
      if (!row) return undefined;
      await this.db.run(`UPDATE sync_queue SET status='uploading', attempt_count=attempt_count+1, updated_at=? WHERE queue_id=?`, [now, row.queue_id]);
      return fromRow({ ...row, status: "uploading", attempt_count: row.attempt_count + 1 });
    });
  }

  async retrySessions(sessionIds: readonly string[], now: string): Promise<void> {
    const ids = [...new Set(sessionIds.filter(Boolean))];
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(",");
    await this.db.run(
      `UPDATE sync_queue SET status='pending', next_attempt_at=NULL, last_error=NULL, updated_at=?
       WHERE revision_id IN (SELECT revision_id FROM revisions WHERE session_id IN (${placeholders}))
         AND status IN ('failed','pending')`,
      [now, ...ids]
    );
  }

  async markSynced(queueId: string, now: string): Promise<void> {
    await this.db.run(`UPDATE sync_queue SET status='synced', next_attempt_at=NULL, last_error=NULL, updated_at=? WHERE queue_id=?`, [now, queueId]);
  }
  async markConflict(queueId: string, message: string, now: string): Promise<void> {
    await this.db.run(`UPDATE sync_queue SET status='conflict', next_attempt_at=NULL, last_error=?, updated_at=? WHERE queue_id=?`, [message, now, queueId]);
  }
  async markFailed(queueId: string, error: string, nextAttemptAt: string, now: string): Promise<void> {
    await this.db.run(`UPDATE sync_queue SET status='failed', next_attempt_at=?, last_error=?, updated_at=? WHERE queue_id=?`, [nextAttemptAt, error, now, queueId]);
  }
  async recoverInterrupted(now: string): Promise<void> {
    await this.db.run(`UPDATE sync_queue SET status='failed', last_error='INTERRUPTED_UPLOAD', next_attempt_at=?, updated_at=? WHERE status='uploading'`, [now, now]);
  }
  async counts(): Promise<Record<SyncQueueStatus, number>> {
    const rows = await this.db.all<{ status: SyncQueueStatus; count: number }>(`SELECT status, COUNT(*) AS count FROM sync_queue GROUP BY status`);
    const result: Record<SyncQueueStatus, number> = { pending: 0, uploading: 0, synced: 0, failed: 0, conflict: 0 };
    for (const row of rows) result[row.status] = row.count;
    return result;
  }
}
