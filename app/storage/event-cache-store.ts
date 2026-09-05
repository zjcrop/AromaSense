import type { EventManifest } from "../core/submission-bundle";
import { canonicalJson, sha256Hex } from "../core/revision-builder";
import type { SQLiteDriver } from "./local-cupping-repository";

interface EventRow { event_revision: number; event_manifest_json: string; content_hash: string; updated_at: string; }

export class EventCacheStore {
  constructor(private readonly db: SQLiteDriver) {}

  async put(manifest: EventManifest, now: string): Promise<{ status: "created" | "already_present" | "updated"; contentHash: string }> {
    const contentHash = await sha256Hex(canonicalJson(manifest));
    const existing = await this.db.get<EventRow>("SELECT event_revision, event_manifest_json, content_hash, updated_at FROM event_cache WHERE event_id = ?", [manifest.eventId]);
    if (existing?.event_revision === manifest.eventRevision && existing.content_hash === contentHash) return { status: "already_present", contentHash };
    if (existing && manifest.eventRevision < existing.event_revision) throw new Error("STALE_EVENT_REVISION");
    if (existing && manifest.eventRevision === existing.event_revision && existing.content_hash !== contentHash) throw new Error("EVENT_REVISION_CONFLICT");
    await this.db.run(
      `INSERT INTO event_cache (event_id, event_revision, event_manifest_json, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET event_revision=excluded.event_revision, event_manifest_json=excluded.event_manifest_json,
       content_hash=excluded.content_hash, updated_at=excluded.updated_at`,
      [manifest.eventId, manifest.eventRevision, JSON.stringify(manifest), contentHash, now]
    );
    return { status: existing ? "updated" : "created", contentHash };
  }

  async get(eventId: string): Promise<EventManifest | undefined> {
    const row = await this.db.get<EventRow>("SELECT event_revision, event_manifest_json, content_hash, updated_at FROM event_cache WHERE event_id = ?", [eventId]);
    return row ? JSON.parse(row.event_manifest_json) as EventManifest : undefined;
  }
}
