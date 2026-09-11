import baseWorker from "./index";
import { handleRecordSyncRoute } from "./sync-record-routes";

interface Env {
  BUILD_SHA?: string;
  DB?: D1Database;
  FIREBASE_PROJECT_ID?: string;
  PUBLIC_APP_URL?: string;
  ZHIPU_API_KEY?: string;
  ZHIPU_MODEL?: string;
}

interface SyncUser { userId: string; }

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function authenticateRecordSync(request: Request, db: D1Database): Promise<SyncUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT u.user_id FROM auth_tokens t
    JOIN users u ON u.user_id = t.user_id
    WHERE t.token_hash = ?1 AND t.expires_at > ?2 AND u.email_verified_at IS NOT NULL
  `).bind(tokenHash, now).first<{ user_id: string }>();
  return row ? { userId: row.user_id } : null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const recordRoute = url.pathname === "/api/v1/records" || url.pathname.startsWith("/api/v1/records/");
    if (recordRoute && request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, PUT, OPTIONS"
      }
    });
    if (recordRoute) {
      if (!env.DB) return json({ ok: false, error: "DB_NOT_CONFIGURED" }, 503);
      const user = await authenticateRecordSync(request, env.DB);
      if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
      const response = await handleRecordSyncRoute(request, url, env.DB, user);
      if (response) return response;
    }
    return baseWorker.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
