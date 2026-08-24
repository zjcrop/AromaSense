interface Env {
  DB?: D1Database;
}

type JsonValue = Record<string, unknown> | unknown[];

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "aromasense-api",
        version: "0.1.0",
        database: env.DB ? "configured" : "not-configured",
        timestamp: new Date().toISOString()
      });
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

        if (
          typeof payload !== "object" ||
          payload === null ||
          typeof (payload as { value?: unknown }).value !== "string"
        ) {
          return json(
            {
              ok: false,
              error: "INVALID_PAYLOAD",
              message: "Expected JSON object with string field 'value'."
            },
            400
          );
        }

        const value = (payload as { value: string }).value.trim();
        if (value.length === 0 || value.length > 200) {
          return json(
            {
              ok: false,
              error: "INVALID_VALUE",
              message: "value must contain 1-200 characters."
            },
            400
          );
        }

        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO infrastructure_test (id, value) VALUES (?1, ?2)"
        )
          .bind(id, value)
          .run();

        return json({ ok: true, id, value }, 201);
      }

      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }
} satisfies ExportedHandler<Env>;
