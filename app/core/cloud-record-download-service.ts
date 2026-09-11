import type { CuppingRecordSnapshot } from "./session-record-service";
import type { SQLiteDriver } from "../storage/local-cupping-repository";

interface RemoteRecordEnvelope {
  recordId: string;
  updatedAt: string;
  deletedAt?: string;
  payload?: CuppingRecordSnapshot;
  serverChangedAt: string;
  changeId: number;
}

interface PullPage {
  ok: true;
  records: RemoteRecordEnvelope[];
  nextCursor: number;
  hasMore: boolean;
}

export interface CloudRecordIndexEntry {
  recordId: string;
  date: string;
  organizer: string;
  eventName: string;
  status: "unfinished" | "completed";
  statusLabel: "进行中" | "已完成";
  sampleCount: number;
  updatedAt: string;
}

export interface CloudRecordDownloadResult {
  downloaded: number;
  skipped: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value?: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function parseSnapshot(value: unknown, recordId: string): CuppingRecordSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`CLOUD_RECORD_INVALID:${recordId}`);
  const snapshot = value as CuppingRecordSnapshot;
  if (!snapshot.session || snapshot.session.sessionId !== recordId || !Array.isArray(snapshot.samples)
    || !Array.isArray(snapshot.observations) || !Array.isArray(snapshot.stageStates)) {
    throw new Error(`CLOUD_RECORD_INVALID:${recordId}`);
  }
  return snapshot;
}

export class CloudRecordDownloadService {
  private readonly baseUrl: string;

  constructor(
    private readonly db: SQLiteDriver,
    baseUrl: string,
    private readonly tokenProvider: () => Promise<string | undefined>,
    private readonly now: () => string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async list(): Promise<readonly CloudRecordIndexEntry[]> {
    const latest = await this.loadLatestRemoteRecords();
    return [...latest.values()]
      .filter((remote) => !remote.deletedAt && remote.payload)
      .map((remote) => this.toIndexEntry(remote, parseSnapshot(remote.payload, remote.recordId)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async download(recordIds: readonly string[]): Promise<CloudRecordDownloadResult> {
    const wanted = new Set(recordIds);
    if (!wanted.size) return { downloaded: 0, skipped: 0 };
    const latest = await this.loadLatestRemoteRecords();
    let downloaded = 0;
    let skipped = 0;
    for (const recordId of wanted) {
      const remote = latest.get(recordId);
      if (!remote || remote.deletedAt || !remote.payload) { skipped += 1; continue; }
      const localUpdatedAt = await this.localVersion(recordId);
      if (timestamp(localUpdatedAt) > timestamp(remote.updatedAt)) { skipped += 1; continue; }
      await this.applySnapshot(parseSnapshot(remote.payload, recordId));
      await this.db.run(
        `INSERT INTO record_sync_state (record_id, last_pushed_at, deleted_at, updated_at)
         VALUES (?, ?, NULL, ?) ON CONFLICT(record_id) DO UPDATE SET
         last_pushed_at=excluded.last_pushed_at, deleted_at=NULL, updated_at=excluded.updated_at`,
        [recordId, remote.updatedAt, this.now()]
      );
      downloaded += 1;
    }
    return { downloaded, skipped };
  }

  private async requireToken(): Promise<string> {
    const token = await this.tokenProvider();
    if (!token) throw new Error("请先登录账户后查看云端记录");
    return token;
  }

  private async pull(cursor: number): Promise<PullPage> {
    const token = await this.requireToken();
    const response = await fetch(`${this.baseUrl}/api/v1/records?cursor=${Math.max(0, cursor)}&limit=500`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json() as PullPage | { ok: false; error: string };
    if (!response.ok || body.ok !== true) throw new Error(`云端记录读取失败（${response.status}）`);
    return body as PullPage;
  }

  private async loadLatestRemoteRecords(): Promise<Map<string, RemoteRecordEnvelope>> {
    const latest = new Map<string, RemoteRecordEnvelope>();
    let cursor = 0;
    for (let pageCount = 0; pageCount < 200; pageCount += 1) {
      const page = await this.pull(cursor);
      for (const remote of page.records) {
        const previous = latest.get(remote.recordId);
        if (!previous || remote.changeId >= previous.changeId) latest.set(remote.recordId, remote);
      }
      if (!page.hasMore || page.nextCursor <= cursor) break;
      cursor = page.nextCursor;
    }
    return latest;
  }

  private toIndexEntry(remote: RemoteRecordEnvelope, snapshot: CuppingRecordSnapshot): CloudRecordIndexEntry {
    const metadata = snapshot.session.metadata as Record<string, unknown>;
    const unfinished = snapshot.session.status === "draft" || snapshot.session.status === "active";
    return {
      recordId: remote.recordId,
      date: text(metadata.date) || snapshot.session.createdAt.slice(0, 10),
      organizer: text(metadata.organizer) || text(metadata.organizerName) || "未标注组织方",
      eventName: text(metadata.eventName) || text(snapshot.session.title) || "未命名杯测",
      status: unfinished ? "unfinished" : "completed",
      statusLabel: unfinished ? "进行中" : "已完成",
      sampleCount: snapshot.samples.length,
      updatedAt: remote.updatedAt
    };
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
}
