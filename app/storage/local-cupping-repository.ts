import type { StageId, SensoryObservation } from "../../shared/protocol/aromasense-v1";
import type { CuppingSession } from "../core/session-lifecycle";
import type { CuppingSessionMetadata } from "../core/session-metadata";
import type { SampleRecord } from "../core/sample-batch-service";
import type { StageStatus } from "../core/cupping-state-machine";

export type SqlValue = string | number | null;

export interface SQLiteDriver {
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<readonly T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface EditingSlice {
  session: CuppingSession;
  sample: SampleRecord;
  stageId: StageId;
  stageStatus: StageStatus;
  observations: readonly SensoryObservation[];
}

interface SessionRow {
  session_id: string;
  title: string | null;
  metadata_json: string;
  status: CuppingSession["status"];
  taxonomy_version: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface SampleRow {
  sample_id: string;
  session_id: string;
  display_number: number;
  sort_order: number;
  label: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface StageRow { status: StageStatus; }
interface ObservationRow {
  observation_id: string;
  session_id: string;
  sample_id: string;
  stage_id: StageId;
  field_key: string;
  value_json: string;
  dictionary_version: string;
  updated_at: string;
}

function parseJsonObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_OBJECT_JSON_IN_LOCAL_DB");
  return parsed as Record<string, unknown>;
}

function legacyMetadata(createdAt: string): CuppingSessionMetadata {
  const date = new Date(createdAt);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16), organizer: "历史记录" };
}

function sessionMetadata(row: SessionRow): CuppingSessionMetadata {
  try {
    const parsed = parseJsonObject(row.metadata_json || "{}");
    const date = String(parsed.date ?? "").trim();
    const time = String(parsed.time ?? "").trim();
    const organizer = String(parsed.organizer ?? "").trim();
    if (!date || !time || !organizer) return legacyMetadata(row.created_at);
    return {
      date, time, organizer,
      participants: typeof parsed.participants === "string" && parsed.participants.trim() ? parsed.participants.trim() : undefined,
      target: typeof parsed.target === "string" && parsed.target.trim() ? parsed.target.trim() : undefined,
      eventName: typeof parsed.eventName === "string" && parsed.eventName.trim() ? parsed.eventName.trim() : undefined
    };
  } catch { return legacyMetadata(row.created_at); }
}

function sessionFromRow(row: SessionRow): CuppingSession {
  return {
    sessionId: row.session_id,
    title: row.title ?? undefined,
    metadata: sessionMetadata(row),
    status: row.status,
    taxonomyVersion: row.taxonomy_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

function sampleFromRow(row: SampleRow): SampleRecord {
  return {
    sampleId: row.sample_id,
    sessionId: row.session_id,
    displayNumber: row.display_number,
    sortOrder: row.sort_order,
    label: row.label ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function observationFromRow(row: ObservationRow): SensoryObservation {
  return {
    observationId: row.observation_id,
    sessionId: row.session_id,
    sampleId: row.sample_id,
    stageId: row.stage_id,
    fieldKey: row.field_key,
    value: JSON.parse(row.value_json) as unknown,
    dictionaryVersion: row.dictionary_version,
    updatedAt: row.updated_at
  };
}

export class LocalCuppingRepository {
  constructor(private readonly db: SQLiteDriver) {}

  async createSessionWithSamples(session: CuppingSession, samples: readonly SampleRecord[]): Promise<void> {
    if (samples.some((sample) => sample.sessionId !== session.sessionId)) throw new Error("SAMPLE_SESSION_MISMATCH");
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO sessions (
          session_id, title, metadata_json, status, taxonomy_version, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [session.sessionId, session.title ?? null, JSON.stringify(session.metadata), session.status, session.taxonomyVersion,
          session.createdAt, session.updatedAt, session.completedAt ?? null]
      );
      for (const sample of samples) {
        await this.db.run(
          `INSERT INTO samples (
            sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sample.sampleId, sample.sessionId, sample.displayNumber, sample.sortOrder,
            sample.label ?? null, JSON.stringify(sample.metadata), sample.createdAt, sample.updatedAt]
        );
      }
    });
  }

  async getSession(sessionId: string): Promise<CuppingSession> {
    const row = await this.db.get<SessionRow>(
      `SELECT session_id, title, metadata_json, status, taxonomy_version, created_at, updated_at, completed_at
       FROM sessions WHERE session_id = ?`, [sessionId]
    );
    if (!row) throw new Error(`SESSION_NOT_FOUND:${sessionId}`);
    return sessionFromRow(row);
  }

  async saveSession(session: CuppingSession): Promise<void> {
    await this.db.run(
      `UPDATE sessions SET title = ?, metadata_json = ?, status = ?, taxonomy_version = ?, updated_at = ?, completed_at = ?
       WHERE session_id = ?`,
      [session.title ?? null, JSON.stringify(session.metadata), session.status, session.taxonomyVersion,
        session.updatedAt, session.completedAt ?? null, session.sessionId]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId]);
  }

  async replaceSampleOrder(sessionId: string, samples: readonly SampleRecord[]): Promise<void> {
    if (samples.some((sample) => sample.sessionId !== sessionId)) throw new Error("SAMPLE_SESSION_MISMATCH");
    await this.db.transaction(async () => {
      await this.db.run(`UPDATE samples SET sort_order = -sort_order WHERE session_id = ?`, [sessionId]);
      for (const sample of samples) {
        await this.db.run(
          `UPDATE samples SET sort_order = ?, updated_at = ? WHERE session_id = ? AND sample_id = ?`,
          [sample.sortOrder, sample.updatedAt, sessionId, sample.sampleId]
        );
      }
    });
  }

  async setStageState(sessionId: string, sampleId: string, stageId: StageId, status: StageStatus,
    now: string, startedAt?: string, completedAt?: string): Promise<void> {
    await this.db.run(
      `INSERT INTO stage_state (
        session_id, sample_id, stage_id, status, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sample_id, stage_id) DO UPDATE SET
        status = excluded.status,
        started_at = COALESCE(stage_state.started_at, excluded.started_at),
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at`,
      [sessionId, sampleId, stageId, status, startedAt ?? null, completedAt ?? null, now]
    );
  }

  async saveObservation(observation: SensoryObservation): Promise<void> {
    await this.db.run(
      `INSERT INTO observations (
        observation_id, session_id, sample_id, stage_id, field_key, value_json,
        dictionary_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sample_id, stage_id, field_key) DO UPDATE SET
        observation_id = excluded.observation_id,
        value_json = excluded.value_json,
        dictionary_version = excluded.dictionary_version,
        updated_at = excluded.updated_at`,
      [observation.observationId, observation.sessionId, observation.sampleId, observation.stageId,
        observation.fieldKey, JSON.stringify(observation.value), observation.dictionaryVersion,
        observation.updatedAt, observation.updatedAt]
    );
  }

  async loadEditingSlice(sessionId: string, sampleId: string, stageId: StageId): Promise<EditingSlice> {
    const session = await this.getSession(sessionId);
    const sampleRow = await this.db.get<SampleRow>(
      `SELECT sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at
       FROM samples WHERE session_id = ? AND sample_id = ?`, [sessionId, sampleId]
    );
    if (!sampleRow) throw new Error(`SAMPLE_NOT_FOUND:${sampleId}`);
    const stageRow = await this.db.get<StageRow>(
      `SELECT status FROM stage_state WHERE sample_id = ? AND stage_id = ?`, [sampleId, stageId]
    );
    const observations = await this.listObservationsForStage(sampleId, stageId);
    return { session, sample: sampleFromRow(sampleRow), stageId, stageStatus: stageRow?.status ?? "not_started", observations };
  }

  async listSamples(sessionId: string): Promise<readonly SampleRecord[]> {
    const rows = await this.db.all<SampleRow>(
      `SELECT sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at
       FROM samples WHERE session_id = ? ORDER BY sort_order ASC`, [sessionId]
    );
    return rows.map(sampleFromRow);
  }

  async listObservationsForStage(sampleId: string, stageId: StageId): Promise<readonly SensoryObservation[]> {
    const rows = await this.db.all<ObservationRow>(
      `SELECT observation_id, session_id, sample_id, stage_id, field_key, value_json,
              dictionary_version, updated_at
       FROM observations WHERE sample_id = ? AND stage_id = ? ORDER BY field_key`, [sampleId, stageId]
    );
    return rows.map(observationFromRow);
  }

  async listObservationsForSample(sampleId: string): Promise<readonly SensoryObservation[]> {
    const rows = await this.db.all<ObservationRow>(
      `SELECT observation_id, session_id, sample_id, stage_id, field_key, value_json,
              dictionary_version, updated_at
       FROM observations WHERE sample_id = ? ORDER BY stage_id, field_key`, [sampleId]
    );
    return rows.map(observationFromRow);
  }

  async listObservationsForSession(sessionId: string): Promise<readonly SensoryObservation[]> {
    const rows = await this.db.all<ObservationRow>(
      `SELECT observation_id, session_id, sample_id, stage_id, field_key, value_json,
              dictionary_version, updated_at
       FROM observations WHERE session_id = ? ORDER BY sample_id, stage_id, field_key`, [sessionId]
    );
    return rows.map(observationFromRow);
  }
}
