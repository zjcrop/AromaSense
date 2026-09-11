import type { CuppingRecordSnapshot } from "./session-record-service";
import { LocalCuppingRepository, type SQLiteDriver } from "../storage/local-cupping-repository";

interface LocalVersionRow { session_id: string; updated_at: string; }
interface SyncStateRow { record_id: string; last_pushed_at: string | null; deleted_at: string | null; updated_at: string; }

export interface RemoteRecordEnvelope {
  recordId: string;
  updatedAt: string;
  deletedAt?: string;
  payload?: CuppingRecordSnapshot;
  serverChangedAt: string;
  changeId: number;
}

export interface CloudRecordIndexEntry {
  recordId: string;
  date: string;
  organizer: string;
  eventName: string;
  status: string;
  updatedAt: string;
  serverChangedAt: string;
}

interface PushAck {
  ok: true;
  applied: boolean;
  recordId: string;
  updatedAt: string;
  deletedAt?: string;
  serverChangedAt: string;
}

interface PullPage {
  ok: true;
  records: RemoteRecordEnvelope[];
  nextCursor: number;
  hasMore: boolean;
}

interface CloudRecordIndexPage {
  ok: true;
  records: CloudRecordIndexEntry[];
  nextOffset: number;
  hasMore: boolean;
}

interface CloudRecordResponse {
  ok: true;
  record: RemoteRecordEnvelope;
}

export interface RecordSyncRunResult {
  pushed: number;
  pulled: number;
  deleted: number;
  skipped: number;
  failed: number;
}

export interface RecordDownloadResult {
  requested: number;
  pulled: number;
  deleted: number;
  skipped: number;
}

function timestampValue(value?: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function laterTimestamp(a?: string | null, b?: string | null): string | undefined {
  return timestampValue(a) >= timestampValue(b) ? a ?? undefined : b ?? undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: unknown, recordId: string): CuppingRecordSnapshot {
  if (!isObject(value) || !isObject(value.session) || !Array.isArray(value.samples)
    || !Array.isArray(value.observations) || !Array.isArray(value.stageStates)) {
    throw new Error(`SYNC_INVALID_RECORD_PAYLOAD:${recordId}`);
  }
  const snapshot = value as unknown as CuppingRecordSnapshot;
  if (snapshot.session.sessionId !== recordId) throw new Error(`SYNC_RECORD_ID_MISMATCH:${recordId}`);
  if (!snapshot.session.updatedAt || !Number.isFinite(Date.parse(snapshot.session.updatedAt))) {
    throw new Error(`SYNC_INVALID_RECORD_TIMESTAMP:${recordId}`);
  }
  return snapshot;
}

class CloudflareRecordSyncClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly tokenProvider: () => Promise<string | undefined>) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async token(): Promise<string> {
    const token = await this.tokenProvider();
    if (!token) throw new Error("SYNC_AUTH_REQUIRED");
    return token;
  }

  private async authorizedGet<T extends { ok: true }>(path: string): Promise<T> {
    const token = await this.token();
    const response = await fetch(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as T | { ok: false; error: string };
    if (!response.ok || body.ok !== true) {
      throw new Error(`RECORD_SYNC_HTTP_${response.status}:${"error" in body ? body.error : "UNKNOWN"}`);
    }
    return body as T;
  }

  async push(recordId: string, updatedAt: string, payload?: CuppingRecordSnapshot, deletedAt?: string): Promise<PushAck> {
    const token = await this.token();
    const response = await fetch(`${this.baseUrl}/api/v1/records/${encodeURIComponent(recordId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ recordId, updatedAt, deletedAt, payload })
    });
    const body = await response.json() as PushAck | { ok: false; error: string };
    if (!response.ok || body.ok !== true) {
      throw new Error(`RECORD_SYNC_HTTP_${response.status}:${"error" in body ? body.error : "UNKNOWN"}`);
    }
    return body as PushAck;
  }

  pull(cursor: number, limit = 200): Promise<PullPage> {
    return this.authorizedGet<PullPage>(`/api/v1/records?cursor=${Math.max(0, cursor)}&limit=${Math.max(1, Math.min(500, limit))}`);
  }

  listIndex(offset: number, limit = 200): Promise<CloudRecordIndexPage> {
    return this.authorizedGet<CloudRecordIndexPage>(`/api/v1/records/index?offset=${Math.max(0, offset)}&limit=${Math.max(1, Math.min(500, limit))}`);
  }

  async getRecord(recordId: string): Promise<RemoteRecordEnvelope> {
    const response = await this.authorizedGet<CloudRecordResponse>(`/api/v1/records/${encodeURIComponent(recordId)}`);
    return response.record;
  }
}

export class RecordSyncService {
  private readonly client: CloudflareRecordSyncClient;
  private inFlight?: Promise<RecordSyncRunResult>;

  constructor(
    private readonly db: SQLiteDriver,
    baseUrl: string,
    tokenProvider: () => Promise<string | undefined>,
    private readonly now: () => string
  ) {
    this.client = new CloudflareRecordSyncClient(baseUrl, tokenProvider);
  }

  sync(): Promise<RecordSyncRunResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  async listCloudRecords(): Promise<CloudRecordIndexEntry[]> {
    const records: CloudRecordIndexEntry[] = [];
    let offset = 0;
    for (let pageCount = 0; pageCount < 50; pageCount += 1) {
      const page = await this.client.listIndex(offset);
      records.push(...page.records);
      offset = Math.max(offset, page.nextOffset);
      if (!page.hasMore) break;
    }
    return records.sort((a, b) => {
      const dateCompare = (b.date || b.updatedAt.slice(0, 10)).localeCompare(a.date || a.updatedAt.slice(0, 10));
      return dateCompare || b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  async downloadRecords(recordIds: readonly string[]): Promise<RecordDownloadResult> {
    const uniqueIds = [...new Set(recordIds.filter(Boolean))];
    const result: RecordDownloadResult = { requested: uniqueIds.length, pulled: 0, deleted: 0, skipped: 0 };
    for (const recordId of uniqueIds) {
      const remote = await this.client.getRecord(recordId);
      const applied = await this.applyRemote(remote);
      if (applied === "pulled") result.pulled += 1;
      else if (applied === "deleted") result.deleted += 1;
      else result.skipped += 1;
    }
    return result;
  }

  private async run(): Promise<RecordSyncRunResult> {
    const result: RecordSyncRunResult = { pushed: 0, pulled: 0, deleted: 0, skipped: 0, failed: 0 };
    const local = await this.listLocalVersions();
    let firstError: unknown;

    for (const record of local) {
      const state = await this.getState(record.session_id);
      if (state?.deleted_at && timestampValue(state.deleted_at) >= timestampValue(record.updated_at)) {
        await this.db.run(`DELETE FROM sessions WHERE session_id = ?`, [record.session_id]);
        result.deleted += 1;
        continue;
      }
      if (state?.deleted_at && timestampValue(record.updated_at) > timestampValue(state.deleted_at)) {
        await this.db.run(
          `UPDATE record_sync_state SET deleted_at = NULL, last_pushed_at = NULL, updated_at = ? WHERE record_id = ?`,
          [this.now(), record.session_id]
        );
      }
      if (!state?.last_pushed_at || timestampValue(record.updated_at) > timestampValue(state.last_pushed_at)) {
        try {
          const snapshot = await this.snapshot(record.session_id);
          const ack = await this.client.push(record.session_id, record.updated_at, snapshot);
          await this.clearFailure(record.session_id);
          const ackEvent = ack.deletedAt ?? ack.updatedAt;
          if (!ack.deletedAt && timestampValue(ackEvent) === timestampValue(record.updated_at)) {
            await this.saveState(record.session_id, record.updated_at, undefined);
          }
          result.pushed += 1;
        } catch (error) {
          await this.saveFailure(record.session_id, error);
          result.failed += 1;
          firstError ??= error;
        }
      }
    }

    const tombstones = await this.db.all<SyncStateRow>(
      `SELECT record_id, last_pushed_at, deleted_at, updated_at FROM record_sync_state WHERE deleted_at IS NOT NULL`
    );
    for (const tombstone of tombstones) {
      const deletedAt = tombstone.deleted_at!;
      if (!tombstone.last_pushed_at || timestampValue(deletedAt) > timestampValue(tombstone.last_pushed_at)) {
        try {
          const ack = await this.client.push(tombstone.record_id, deletedAt, undefined, deletedAt);
          await this.clearFailure(tombstone.record_id);
          if (ack.deletedAt && timestampValue(ack.deletedAt) >= timestampValue(deletedAt)) {
            await this.saveState(tombstone.record_id, deletedAt, deletedAt);
          }
          result.pushed += 1;
        } catch (error) {
          await this.saveFailure(tombstone.record_id, error);
          result.failed += 1;
          firstError ??= error;
        }
      }
    }

    try {
      let cursor = await this.getCursor();
      for (let pageCount = 0; pageCount < 100; pageCount += 1) {
        const page = await this.client.pull(cursor);
        for (const remote of page.records) {
          const applied = await this.applyRemote(remote);
          if (applied === "pulled") result.pulled += 1;
          else if (applied === "deleted") result.deleted += 1;
          else result.skipped += 1;
        }
        cursor = Math.max(cursor, page.nextCursor);
        await this.setCursor(cursor);
        if (!page.hasMore) break;
      }
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
    return result;
  }

  private async listLocalVersions(): Promise<readonly LocalVersionRow[]> {
    return this.db.all<LocalVersionRow>(`
      SELECT session_id, MAX(updated_at) AS updated_at FROM (
        SELECT session_id, updated_at FROM sessions
        UNION ALL SELECT session_id, updated_at FROM samples
        UNION ALL SELECT session_id, updated_at FROM stage_state
        UNION ALL SELECT session_id, updated_at FROM observations
      ) GROUP BY session_id ORDER BY session_id
    `);
  }

  private async localVersion(recordId: string): Promise<string | undefined> {
    const row = await this.db.get<{ updated_at: string | null }>(`
      SELECT MAX(updated_at) AS updated_at FROM (
        SELECT updated_at FROM sessions WHERE session_id = ?
        UNION ALL SELECT updated_at FROM samples WHERE session_id = ?
        UNION ALL SELECT updated_at FROM stage_state WHERE session_id = ?
        UNION ALL SELECT updated_at FROM observations WHERE session_id = ?
      )
    `, [recordId, recordId, recordId, recordId]);
    return row?.updated_at ?? undefined;
  }

  private async snapshot(recordId: string): Promise<CuppingRecordSnapshot> {
    const repository = new LocalCuppingRepository(this.db);
    const [session, samples, observations, stageStates] = await Promise.all([
      repository.getSession(recordId), repository.listSamples(recordId),
      repository.listObservationsForSession(recordId), repository.listStageStates(recordId)
    ]);
    return { version: "AromaSense-B0.2.a", exportedAt: this.now(), session, samples, observations, stageStates };
  }

  private async applyRemote(remote: RemoteRecordEnvelope): Promise<"pulled" | "deleted" | "skipped"> {
    const [localUpdatedAt, state] = await Promise.all([this.localVersion(remote.recordId), this.getState(remote.recordId)]);
    const localEvent = laterTimestamp(localUpdatedAt, state?.deleted_at);
    const remoteEvent = remote.deletedAt ?? remote.updatedAt;
    const remoteTime = timestampValue(remoteEvent);
    const localTime = timestampValue(localEvent);
    const localDeleted = Boolean(state?.deleted_at && timestampValue(state.deleted_at) >= timestampValue(localUpdatedAt));

    if (remoteTime < localTime) return "skipped";
    if (remoteTime === localTime) {
      if (remote.deletedAt && !localDeleted) return this.applyRemoteDelete(remote);
      return "skipped";
    }
    if (remote.deletedAt) return this.applyRemoteDelete(remote);
    if (!remote.payload) throw new Error(`SYNC_REMOTE_PAYLOAD_MISSING:${remote.recordId}`);
    await this.applySnapshot(parseSnapshot(remote.payload, remote.recordId));
    await this.saveState(remote.recordId, remote.updatedAt, undefined);
    return "pulled";
  }

  private async applyRemoteDelete(remote: RemoteRecordEnvelope): Promise<"deleted"> {
    const deletedAt = remote.deletedAt ?? remote.updatedAt;
    await this.db.transaction(async () => {
      await this.db.run(`DELETE FROM sessions WHERE session_id = ?`, [remote.recordId]);
      await this.db.run(
        `INSERT INTO record_sync_state (record_id, last_pushed_at, deleted_at, updated_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET
         last_pushed_at = excluded.last_pushed_at, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        [remote.recordId, deletedAt, deletedAt, this.now()]
      );
      await this.db.run(`DELETE FROM record_sync_failures WHERE record_id = ?`, [remote.recordId]);
    });
    return "deleted";
  }

  private async applySnapshot(snapshot: CuppingRecordSnapshot): Promise<void> {
    const session = snapshot.session;
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO sessions (session_id, title, metadata_json, status, taxonomy_version, created_at, started_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET title=excluded.title, metadata_json=excluded.metadata_json,
           status=excluded.status, taxonomy_version=excluded.taxonomy_version, created_at=excluded.created_at,
           started_at=excluded.started_at, updated_at=excluded.updated_at, completed_at=excluded.completed_at`,
        [session.sessionId, session.title ?? null, JSON.stringify(session.metadata), session.status,
          session.taxonomyVersion, session.createdAt, session.startedAt ?? null, session.updatedAt, session.completedAt ?? null]
      );
      await this.db.run(`DELETE FROM samples WHERE session_id = ?`, [session.sessionId]);
      for (const sample of snapshot.samples) {
        await this.db.run(
          `INSERT INTO samples (sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sample.sampleId, session.sessionId, sample.displayNumber, sample.sortOrder, sample.label ?? null,
            JSON.stringify(sample.metadata), sample.createdAt, sample.updatedAt]
        );
      }
      for (const stage of snapshot.stageStates) {
        await this.db.run(
          `INSERT INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [session.sessionId, stage.sampleId, stage.stageId, stage.status,
            stage.startedAt ?? null, stage.completedAt ?? null, stage.updatedAt]
        );
      }
      for (const observation of snapshot.observations) {
        await this.db.run(
          `INSERT INTO observations (observation_id, session_id, sample_id, stage_id, field_key, value_json, dictionary_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [observation.observationId, session.sessionId, observation.sampleId, observation.stageId,
            observation.fieldKey, JSON.stringify(observation.value), observation.dictionaryVersion,
            observation.updatedAt, observation.updatedAt]
        );
      }
    });
  }

  private async getState(recordId: string): Promise<SyncStateRow | undefined> {
    return this.db.get<SyncStateRow>(
      `SELECT record_id, last_pushed_at, deleted_at, updated_at FROM record_sync_state WHERE record_id = ?`, [recordId]
    );
  }

  private async saveState(recordId: string, lastPushedAt: string, deletedAt?: string): Promise<void> {
    await this.db.run(
      `INSERT INTO record_sync_state (record_id, last_pushed_at, deleted_at, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET
       last_pushed_at=excluded.last_pushed_at, deleted_at=excluded.deleted_at, updated_at=excluded.updated_at`,
      [recordId, lastPushedAt, deletedAt ?? null, this.now()]
    );
    await this.clearFailure(recordId);
  }

  private async saveFailure(recordId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.db.run(
      `INSERT INTO record_sync_failures (record_id, error_message, failed_at) VALUES (?, ?, ?)
       ON CONFLICT(record_id) DO UPDATE SET error_message=excluded.error_message, failed_at=excluded.failed_at`,
      [recordId, message.slice(0, 1000), this.now()]
    );
  }

  private async clearFailure(recordId: string): Promise<void> {
    await this.db.run(`DELETE FROM record_sync_failures WHERE record_id = ?`, [recordId]);
  }

  private async getCursor(): Promise<number> {
    const row = await this.db.get<{ meta_value: string }>(`SELECT meta_value FROM record_sync_meta WHERE meta_key = 'cloud_cursor'`);
    const value = Number(row?.meta_value ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  private async setCursor(cursor: number): Promise<void> {
    await this.db.run(
      `INSERT INTO record_sync_meta (meta_key, meta_value, updated_at) VALUES ('cloud_cursor', ?, ?)
       ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value, updated_at=excluded.updated_at`,
      [String(cursor), this.now()]
    );
  }
}
