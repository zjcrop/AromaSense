interface Env {
  DB?: D1Database;
}

type JsonValue = Record<string, unknown> | unknown[];

interface RevisionPayload {
  protocolVersion: "aromasense-sync/1.0";
  revisionId: string;
  revisionKind: "checkpoint" | "final";
  sessionId: string;
  sampleId?: string;
  stageId?: string;
  sequence: number;
  createdAt: string;
  contentHash: string;
  payload: Record<string, unknown>;
}

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function dbUnavailable(): Response {
  return json(
    {
      ok: false,
      error: "DB_NOT_CONFIGURED",
      message: "Cloudflare D1 binding 'DB' is not configured yet."
    },
    503
  );
}

function isNonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isRevisionPayload(value: unknown): value is RevisionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.protocolVersion === "aromasense-sync/1.0" &&
    isNonEmptyString(v.revisionId) &&
    (v.revisionKind === "checkpoint" || v.revisionKind === "final") &&
    isNonEmptyString(v.sessionId) &&
    Number.isSafeInteger(v.sequence) &&
    Number(v.sequence) >= 0 &&
    isNonEmptyString(v.createdAt) &&
    isNonEmptyString(v.contentHash, 128) &&
    typeof v.payload === "object" &&
    v.payload !== null &&
    !Array.isArray(v.payload) &&
    (v.sampleId === undefined || isNonEmptyString(v.sampleId)) &&
    (v.stageId === undefined || isNonEmptyString(v.stageId))
  );
}

async function handleRevisionPost(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  if (!isRevisionPayload(body)) {
    return json({ ok: false, error: "INVALID_REVISION_PAYLOAD" }, 400);
  }

  const existing = await db
    .prepare("SELECT content_hash FROM sync_revisions WHERE revision_id = ?1")
    .bind(body.revisionId)
    .first<{ content_hash: string }>();

  if (existing) {
    if (existing.content_hash === body.contentHash) {
      return json({
        ok: true,
        revisionId: body.revisionId,
        contentHash: body.contentHash,
        status: "already_present"
      });
    }

    return json(
      {
        ok: false,
        error: "REVISION_CONFLICT",
        revisionId: body.revisionId,
        existingHash: existing.content_hash
      },
      409
    );
  }

  try {
    await db.prepare(`
      INSERT INTO sync_revisions (
        revision_id, protocol_version, revision_kind, session_id,
        sample_id, stage_id, sequence, content_hash, payload_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `)
      .bind(
        body.revisionId,
        body.protocolVersion,
        body.revisionKind,
        body.sessionId,
        body.sampleId ?? null,
        body.stageId ?? null,
        body.sequence,
        body.contentHash,
        JSON.stringify(body.payload),
        body.createdAt
      )
      .run();
  } catch (error) {
    return json(
      {
        ok: false,
        error: "REVISION_WRITE_FAILED",
        message: error instanceof Error ? error.message : "Unknown database error"
      },
      409
    );
  }

  return json(
    {
      ok: true,
      revisionId: body.revisionId,
      contentHash: body.contentHash,
      status: "created"
    },
    201
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "aromasense-api",
        version: "0.2.0",
        protocol: "aromasense-sync/1.0",
        database: env.DB ? "configured" : "not-configured",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/v1/revisions") {
      if (!env.DB) return dbUnavailable();
      if (request.method === "POST") return handleRevisionPost(request, env.DB);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (url.pathname.startsWith("/api/v1/revisions/") && request.method === "GET") {
      if (!env.DB) return dbUnavailable();
      const revisionId = decodeURIComponent(url.pathname.slice("/api/v1/revisions/".length));
      if (!isNonEmptyString(revisionId)) return json({ ok: false, error: "INVALID_REVISION_ID" }, 400);

      const row = await env.DB.prepare(`
        SELECT revision_id, protocol_version, revision_kind, session_id,
               sample_id, stage_id, sequence, content_hash, payload_json,
               created_at, received_at
        FROM sync_revisions WHERE revision_id = ?1
      `).bind(revisionId).first<Record<string, unknown>>();

      if (!row) return json({ ok: false, error: "REVISION_NOT_FOUND" }, 404);
      return json({ ok: true, revision: row });
    }

    if (url.pathname === "/api/v1/test/records") {
      if (!env.DB) return dbUnavailable();

      if (request.method === "GET") {
        const result = await env.DB.prepare(
          "SELECT id, value, created_at FROM infrastructure_test ORDER BY created_at DESC LIMIT 20"
        ).all();
        return json({ ok: true, records: result.results ?? [] });
      }

      if (request.method === "POST") {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ ok: false, error: "INVALID_JSON" }, 400);
        }
        if (typeof payload !== "object" || payload === null || typeof (payload as { value?: unknown }).value !== "string") {
          return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
        }
        const value = (payload as { value: string }).value.trim();
        if (value.length === 0 || value.length > 200) return json({ ok: false, error: "INVALID_VALUE" }, 400);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO infrastructure_test (id, value) VALUES (?1, ?2)").bind(id, value).run();
        return json({ ok: true, id, value }, 201);
      }

      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }
} satisfies ExportedHandler<Env>;
