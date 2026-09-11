interface SyncUser { userId: string; }

interface RecordIndexRow {
  record_id: string;
  date: string | null;
  organizer: string | null;
  event_name: string | null;
  status: string | null;
  updated_at: string;
  server_changed_at: string;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, OPTIONS"
    }
  });
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function handleLightweightRecordIndexRoute(
  request: Request,
  url: URL,
  db: D1Database,
  user: SyncUser
): Promise<Response | undefined> {
  if (url.pathname !== "/api/v1/records/index") return undefined;
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const offsetRaw = Number(url.searchParams.get("offset") || "0");
  const limitRaw = Number(url.searchParams.get("limit") || "200");
  const offset = Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const limit = Number.isSafeInteger(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 200;

  const result = await db.prepare(`
    SELECT
      record_id,
      COALESCE(
        NULLIF(TRIM(json_extract(payload_json, '$.session.metadata.date')), ''),
        SUBSTR(COALESCE(json_extract(payload_json, '$.session.createdAt'), updated_at), 1, 10)
      ) AS date,
      COALESCE(NULLIF(TRIM(json_extract(payload_json, '$.session.metadata.organizer')), ''), '') AS organizer,
      COALESCE(
        NULLIF(TRIM(json_extract(payload_json, '$.session.metadata.eventName')), ''),
        NULLIF(TRIM(json_extract(payload_json, '$.session.title')), ''),
        ''
      ) AS event_name,
      COALESCE(NULLIF(TRIM(json_extract(payload_json, '$.session.status')), ''), 'draft') AS status,
      updated_at,
      server_changed_at
    FROM sync_records
    WHERE owner_user_id = ?1 AND deleted_at IS NULL
    ORDER BY updated_at DESC, record_id ASC
    LIMIT ?2 OFFSET ?3
  `).bind(user.userId, limit, offset).all<RecordIndexRow>();

  const rows = result.results ?? [];
  return json({
    ok: true,
    records: rows.map((row) => ({
      recordId: row.record_id,
      date: text(row.date),
      organizer: text(row.organizer),
      eventName: text(row.event_name),
      status: text(row.status) || "draft",
      updatedAt: row.updated_at,
      serverChangedAt: row.server_changed_at
    })),
    nextOffset: offset + rows.length,
    hasMore: rows.length === limit
  });
}
