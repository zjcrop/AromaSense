import { STAGE_IDS } from "../../shared/protocol/aromasense-v1";
import { fieldsForStage } from "../core/sensory-dictionary-v1";
import { normalizeSessionMetadata, sessionDisplayName, type CuppingSessionMetadata } from "../core/session-metadata";
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
  syncError?: string;
}

interface RecordRow {
  session_id: string;
  title: string | null;
  metadata_json: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  local_updated_at: string | null;
  sample_count: number;
  completed_samples: number;
  observation_count: number;
  last_pushed_at: string | null;
  deleted_at: string | null;
  failure_error: string | null;
  failed_at: string | null;
}

const FINAL_EXTRA_FIELD_COUNT = 6 + 8 + 3 + 1 + 1 + 1;
const EXPECTED_FIELDS_PER_SAMPLE = STAGE_IDS.reduce((sum, stage) => sum + fieldsForStage(stage).length, 0) + FINAL_EXTRA_FIELD_COUNT;

function timestampValue(value?: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function legacyMetadata(createdAt: string): CuppingSessionMetadata {
  const date = new Date(createdAt);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16), organizer: "历史记录" };
}

function metadataFromRow(row: RecordRow): CuppingSessionMetadata {
  try {
    const value = JSON.parse(row.metadata_json || "{}") as Partial<CuppingSessionMetadata>;
    return normalizeSessionMetadata(value);
  } catch { return legacyMetadata(row.created_at); }
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
      local_versions AS (
        SELECT session_id, MAX(updated_at) AS local_updated_at
        FROM (
          SELECT session_id, updated_at FROM sessions
          UNION ALL SELECT session_id, updated_at FROM samples
          UNION ALL SELECT session_id, updated_at FROM stage_state
          UNION ALL SELECT session_id, updated_at FROM observations
        )
        GROUP BY session_id
      )
      SELECT
        s.session_id, s.title, s.metadata_json, s.status, s.created_at, s.updated_at,
        versions.local_updated_at,
        COALESCE(samples.sample_count, 0) AS sample_count,
        COALESCE(completed.completed_samples, 0) AS completed_samples,
        COALESCE(observations.observation_count, 0) AS observation_count,
        sync.last_pushed_at,
        sync.deleted_at,
        failure.error_message AS failure_error,
        failure.failed_at
      FROM sessions s
      LEFT JOIN sample_stats samples ON samples.session_id = s.session_id
      LEFT JOIN completion_stats completed ON completed.session_id = s.session_id
      LEFT JOIN observation_stats observations ON observations.session_id = s.session_id
      LEFT JOIN local_versions versions ON versions.session_id = s.session_id
      LEFT JOIN record_sync_state sync ON sync.record_id = s.session_id
      LEFT JOIN record_sync_failures failure ON failure.record_id = s.session_id
      ORDER BY s.updated_at DESC
      LIMIT ?`, [safeLimit]);

    return rows.map((row) => {
      const sampleCount = Number(row.sample_count) || 0;
      const completedSamples = Number(row.completed_samples) || 0;
      const observationCount = Number(row.observation_count) || 0;
      const expected = Math.max(1, sampleCount * EXPECTED_FIELDS_PER_SAMPLE);
      const metadata = metadataFromRow(row);
      const localVersion = row.local_updated_at ?? row.updated_at;
      const syncState: RecordSyncState = row.failed_at
        ? "failed"
        : !row.deleted_at && timestampValue(row.last_pushed_at) >= timestampValue(localVersion)
          ? "synced"
          : "pending";
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
        syncState,
        syncError: row.failure_error ?? undefined
      };
    });
  }
}
