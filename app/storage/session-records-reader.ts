import { STAGE_IDS } from "../../shared/protocol/aromasense-v1";
import { fieldsForStage } from "../core/sensory-dictionary-v1";
import type { CuppingSessionMetadata } from "../core/session-metadata";
import { sessionDisplayName } from "../core/session-metadata";
import type { SessionStatus } from "../core/session-lifecycle";
import type { SQLiteDriver } from "./local-cupping-repository";

export type RecordSyncState = "synced" | "failed" | "pending";

export interface SessionRecordSummary {
  sessionId: string;
  title?: string;
  metadata: CuppingSessionMetadata;
  displayName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  sampleCount: number;
  completedSamples: number;
  completionPct: number;
  completenessPct: number;
  syncState: RecordSyncState;
}

interface RecordRow {
  session_id: string;
  title: string | null;
  metadata_json: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  sample_count: number;
  completed_samples: number;
  observation_count: number;
  revision_count: number;
  synced_count: number;
  failed_count: number;
  pending_count: number;
}

const FINAL_EXTRA_FIELD_COUNT = 6 + 8 + 3 + 1 + 1 + 1;
const EXPECTED_FIELDS_PER_SAMPLE = STAGE_IDS.reduce((sum, stage) => sum + fieldsForStage(stage).length, 0) + FINAL_EXTRA_FIELD_COUNT;

function metadataFromRow(row: RecordRow): CuppingSessionMetadata {
  try {
    const value = JSON.parse(row.metadata_json || "{}") as Partial<CuppingSessionMetadata>;
    if (value.date && value.time && value.organizer) return {
      date: String(value.date), time: String(value.time), organizer: String(value.organizer),
      participants: value.participants ? String(value.participants) : undefined,
      target: value.target ? String(value.target) : undefined,
      eventName: value.eventName ? String(value.eventName) : undefined
    };
  } catch { /* legacy fallback below */ }
  const date = new Date(row.created_at);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16), organizer: "历史记录" };
}

export class SessionRecordsReader {
  constructor(private readonly db: SQLiteDriver) {}

  async list(limit = 200): Promise<readonly SessionRecordSummary[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.db.all<RecordRow>(`
      WITH
      sample_stats AS (
        SELECT session_id, COUNT(*) AS sample_count
        FROM samples
        GROUP BY session_id
      ),
      completion_stats AS (
        SELECT session_id, COUNT(DISTINCT sample_id) AS completed_samples
        FROM stage_state
        WHERE status = 'completed'
          AND stage_id IN ('scoring', 'final')
        GROUP BY session_id
      ),
      observation_stats AS (
        SELECT session_id, COUNT(DISTINCT observation_id) AS observation_count
        FROM observations
        GROUP BY session_id
      ),
      revision_stats AS (
        SELECT
          r.session_id,
          COUNT(DISTINCT r.revision_id) AS revision_count,
          COUNT(DISTINCT CASE WHEN q.status = 'synced' THEN r.revision_id END) AS synced_count,
          COUNT(DISTINCT CASE WHEN q.status IN ('failed','conflict') THEN r.revision_id END) AS failed_count,
          COUNT(DISTINCT CASE WHEN q.status IN ('pending','uploading') THEN r.revision_id END) AS pending_count
        FROM revisions r
        LEFT JOIN sync_queue q ON q.revision_id = r.revision_id
        GROUP BY r.session_id
      )
      SELECT
        s.session_id, s.title, s.metadata_json, s.status, s.created_at, s.updated_at,
        COALESCE(samples.sample_count, 0) AS sample_count,
        COALESCE(completed.completed_samples, 0) AS completed_samples,
        COALESCE(observations.observation_count, 0) AS observation_count,
        COALESCE(revisions.revision_count, 0) AS revision_count,
        COALESCE(revisions.synced_count, 0) AS synced_count,
        COALESCE(revisions.failed_count, 0) AS failed_count,
        COALESCE(revisions.pending_count, 0) AS pending_count
      FROM sessions s
      LEFT JOIN sample_stats samples ON samples.session_id = s.session_id
      LEFT JOIN completion_stats completed ON completed.session_id = s.session_id
      LEFT JOIN observation_stats observations ON observations.session_id = s.session_id
      LEFT JOIN revision_stats revisions ON revisions.session_id = s.session_id
      ORDER BY s.updated_at DESC
      LIMIT ?`, [safeLimit]);

    return rows.map((row) => {
      const sampleCount = Number(row.sample_count) || 0;
      const completedSamples = Number(row.completed_samples) || 0;
      const observationCount = Number(row.observation_count) || 0;
      const expected = Math.max(1, sampleCount * EXPECTED_FIELDS_PER_SAMPLE);
      const metadata = metadataFromRow(row);
      const failed = Number(row.failed_count) || 0;
      const pending = Number(row.pending_count) || 0;
      const revisions = Number(row.revision_count) || 0;
      const synced = Number(row.synced_count) || 0;
      const syncState: RecordSyncState = failed > 0 ? "failed" : pending > 0 || revisions === 0 ? "pending" : synced >= revisions ? "synced" : "pending";
      return {
        sessionId: row.session_id,
        title: row.title ?? undefined,
        metadata,
        displayName: sessionDisplayName(metadata, row.title ?? undefined),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sampleCount,
        completedSamples,
        completionPct: sampleCount ? Math.round(completedSamples / sampleCount * 100) : 0,
        completenessPct: Math.min(100, Math.round(observationCount / expected * 100)),
        syncState
      };
    });
  }
}
