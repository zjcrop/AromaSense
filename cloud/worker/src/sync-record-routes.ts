interface SyncUser { userId: string; }

interface SyncRecordBody {
  recordId?: string;
  updatedAt?: string;
  deletedAt?: string;
  payload?: unknown;
}

interface SyncRecordRow {
  record_id: string;
  updated_at: string;
  deleted_at: string | null;
  payload_json: string | null;
  server_changed_at: string;
}

interface SyncChangeRow extends SyncRecordRow {
  change_id: number;
}

const MAX_RECORD_PAYLOAD_BYTES = 2_000_000;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, PUT, OPTIONS"
    }
  });
}

function normalizedTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function eventTime(updatedAt: string, deletedAt?: string | null): number {
  return Date.parse(deletedAt || updatedAt);
}

function validRecordId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

async function putRecord(request: Request, recordId: string, db: D1Database, user: SyncUser): Promise<Response> {
  if (!validRecordId(recordId)) return json({ ok: false, error: "INVALID_RECORD_ID" }, 400);
  let body: SyncRecordBody;
  try { body = await request.json() as SyncRecordBody; }
  catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  if (body.recordId !== undefined && body.recordId !== recordId) {
    return json({ ok: false, error: "RECORD_ID_MISMATCH" }, 400);
  }
  const updatedAt = normalizedTimestamp(body.updatedAt);
  const deletedAt = body.deletedAt === undefined ? undefined : normalizedTimestamp(body.deletedAt);
  if (!updatedAt || (body.deletedAt !== undefined && !deletedAt)) {
    return json({ ok: false, error: "INVALID_RECORD_TIMESTAMP" }, 400);
  }
  if (deletedAt && eventTime(updatedAt, deletedAt) < eventTime(updatedAt)) {
    return json({ ok: false, error: "DELETE_BEFORE_UPDATE" }, 400);
  }

  let payloadJson: string | null = null;
  if (!deletedAt) {
    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      return json({ ok: false, error: "RECORD_PAYLOAD_REQUIRED" }, 400);
    }
    payloadJson = JSON.stringify(body.payload);
    if (new TextEncoder().encode(payloadJson).byteLength > MAX_RECORD_PAYLOAD_BYTES) {
      return json({ ok: false, error: "RECORD_PAYLOAD_TOO_LARGE" }, 413);
    }
  }

  const existing = await db.prepare(`
    SELECT record_id, updated_at, deleted_at, payload_json, server_changed_at
    FROM sync_records WHERE owner_user_id = ?1 AND record_id = ?2
  `).bind(user.userId, recordId).first<SyncRecordRow>();

  const incomingEvent = eventTime(updatedAt, deletedAt);
  const existingEvent = existing ? eventTime(existing.updated_at, existing.deleted_at) : Number.NEGATIVE_INFINITY;
  const deleteWinsTie = Boolean(deletedAt && existing && !existing.deleted_at && incomingEvent === existingEvent);
  const shouldApply = !existing || incomingEvent > existingEvent || deleteWinsTie;

  if (!shouldApply && existing) {
    return json({
      ok: true,
      applied: false,
      recordId,
      updatedAt: existing.updated_at,
      deletedAt: existing.deleted_at ?? undefined,
      serverChangedAt: existing.server_changed_at
    });
  }

  const serverChangedAt = new Date().toISOString();
  await db.batch([
    db.prepare(`
      INSERT INTO sync_records (owner_user_id, record_id, updated_at, deleted_at, payload_json, device_id, server_changed_at)
      VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
      ON CONFLICT(owner_user_id, record_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        payload_json = excluded.payload_json,
        server_changed_at = excluded.server_changed_at
    `).bind(user.userId, recordId, updatedAt, deletedAt ?? null, payloadJson, serverChangedAt),
    db.prepare(`
      INSERT INTO sync_record_changes (owner_user_id, record_id, changed_at)
      VALUES (?1, ?2, ?3)
    `).bind(user.userId, recordId, serverChangedAt)
  ]);

  return json({ ok: true, applied: true, recordId, updatedAt, deletedAt, serverChangedAt });
}

async function listChanges(url: URL, db: D1Database, user: SyncUser): Promise<Response> {
  const cursorRaw = Number(url.searchParams.get("cursor") || "0");
  const limitRaw = Number(url.searchParams.get("limit") || "200");
  const cursor = Number.isSafeInteger(cursorRaw) && cursorRaw >= 0 ? cursorRaw : 0;
  const limit = Number.isSafeInteger(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

  const result = await db.prepare(`
    SELECT c.change_id, r.record_id, r.updated_at, r.deleted_at, r.payload_json, r.server_changed_at
    FROM sync_record_changes c
    JOIN sync_records r ON r.owner_user_id = c.owner_user_id AND r.record_id = c.record_id
    WHERE c.owner_user_id = ?1 AND c.change_id > ?2
    ORDER BY c.change_id ASC
    LIMIT ?3
  `).bind(user.userId, cursor, limit).all<SyncChangeRow>();

  const rows = result.results ?? [];
  const records = rows.map((row) => ({
    changeId: row.change_id,
    recordId: row.record_id,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    payload: row.payload_json ? JSON.parse(row.payload_json) as Record<string, unknown> : undefined,
    serverChangedAt: row.server_changed_at
  }));
  const nextCursor = rows.length ? rows[rows.length - 1]!.change_id : cursor;
  return json({ ok: true, records, nextCursor, hasMore: rows.length === limit });
}

export async function handleRecordSyncRoute(
  request: Request,
  url: URL,
  db: D1Database,
  user: SyncUser
): Promise<Response | undefined> {
  if (url.pathname === "/api/v1/records") {
    if (request.method === "GET") return listChanges(url, db, user);
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (url.pathname.startsWith("/api/v1/records/")) {
    const recordId = decodeURIComponent(url.pathname.slice("/api/v1/records/".length));
    if (request.method === "PUT") return putRecord(request, recordId, db, user);
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  return undefined;
}
