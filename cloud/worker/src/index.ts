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

interface AuthenticatedUser {
  userId: string;
  email: string;
}

const PRODUCT_VERSION = "B0.1.a";
const PASSWORD_ITERATIONS = 160_000;
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS"
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

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !email.includes("@")) return undefined;
  return email;
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("INVALID_HEX");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function passwordHash(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex) as BufferSource, iterations },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function createAuthToken(db: D1Database, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  await db.prepare(
    "INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)"
  ).bind(tokenHash, userId, expiresAt).run();
  return { token, expiresAt };
}

async function authenticate(request: Request, db: D1Database): Promise<AuthenticatedUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT u.user_id, u.email
    FROM auth_tokens t JOIN users u ON u.user_id = t.user_id
    WHERE t.token_hash = ?1 AND t.expires_at > ?2
  `).bind(tokenHash, now).first<{ user_id: string; email: string }>();
  return row ? { userId: row.user_id, email: row.email } : null;
}

async function handleRegister(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (typeof body !== "object" || body === null) return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
  const value = body as Record<string, unknown>;
  const email = normalizeEmail(value.email);
  const password = typeof value.password === "string" ? value.password : "";
  if (!email || password.length < 10 || password.length > 256) {
    return json({ ok: false, error: "INVALID_CREDENTIALS_FORMAT" }, 400);
  }

  const existing = await db.prepare("SELECT user_id FROM users WHERE email = ?1").bind(email).first();
  if (existing) return json({ ok: false, error: "ACCOUNT_EXISTS" }, 409);

  const userId = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await passwordHash(password, salt, PASSWORD_ITERATIONS);
  await db.prepare(`
    INSERT INTO users (user_id, email, password_hash, password_salt, password_iterations)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(userId, email, hash, salt, PASSWORD_ITERATIONS).run();
  const auth = await createAuthToken(db, userId);
  return json({ ok: true, userId, email, ...auth }, 201);
}

async function handleLogin(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (typeof body !== "object" || body === null) return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
  const value = body as Record<string, unknown>;
  const email = normalizeEmail(value.email);
  const password = typeof value.password === "string" ? value.password : "";
  if (!email || !password) return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);

  const row = await db.prepare(`
    SELECT user_id, email, password_hash, password_salt, password_iterations
    FROM users WHERE email = ?1
  `).bind(email).first<{
    user_id: string; email: string; password_hash: string; password_salt: string; password_iterations: number;
  }>();
  if (!row) return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
  const candidate = await passwordHash(password, row.password_salt, row.password_iterations);
  if (!constantTimeEqual(candidate, row.password_hash)) return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
  const auth = await createAuthToken(db, row.user_id);
  return json({ ok: true, userId: row.user_id, email: row.email, ...auth });
}

async function handleLogout(request: Request, db: D1Database): Promise<Response> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return json({ ok: true });
  const token = header.slice(7).trim();
  if (token) await db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
  return json({ ok: true });
}

async function handleRevisionPost(request: Request, db: D1Database, user: AuthenticatedUser): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (!isRevisionPayload(body)) return json({ ok: false, error: "INVALID_REVISION_PAYLOAD" }, 400);

  const existing = await db
    .prepare("SELECT content_hash, owner_user_id FROM sync_revisions WHERE revision_id = ?1")
    .bind(body.revisionId)
    .first<{ content_hash: string; owner_user_id: string | null }>();

  if (existing) {
    if (existing.owner_user_id !== user.userId) return json({ ok: false, error: "REVISION_NOT_FOUND" }, 404);
    if (existing.content_hash === body.contentHash) {
      return json({ ok: true, revisionId: body.revisionId, contentHash: body.contentHash, status: "already_present" });
    }
    return json({ ok: false, error: "REVISION_CONFLICT", revisionId: body.revisionId, existingHash: existing.content_hash }, 409);
  }

  try {
    await db.prepare(`
      INSERT INTO sync_revisions (
        revision_id, protocol_version, revision_kind, session_id,
        sample_id, stage_id, sequence, content_hash, payload_json, created_at, owner_user_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `).bind(
      body.revisionId, body.protocolVersion, body.revisionKind, body.sessionId,
      body.sampleId ?? null, body.stageId ?? null, body.sequence, body.contentHash,
      JSON.stringify(body.payload), body.createdAt, user.userId
    ).run();
  } catch (error) {
    return json({ ok: false, error: "REVISION_WRITE_FAILED", message: error instanceof Error ? error.message : "Unknown database error" }, 409);
  }

  return json({ ok: true, revisionId: body.revisionId, contentHash: body.contentHash, status: "created" }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    }});

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "aromasense-api", version: PRODUCT_VERSION, protocol: "aromasense-sync/1.0", database: env.DB ? "configured" : "not-configured", timestamp: new Date().toISOString() });
    }

    if (!env.DB) return dbUnavailable();

    if (url.pathname === "/api/v1/auth/register" && request.method === "POST") return handleRegister(request, env.DB);
    if (url.pathname === "/api/v1/auth/login" && request.method === "POST") return handleLogin(request, env.DB);
    if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") return handleLogout(request, env.DB);

    const user = await authenticate(request, env.DB);
    if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

    if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
      return json({ ok: true, userId: user.userId, email: user.email });
    }

    if (url.pathname === "/api/v1/revisions") {
      if (request.method === "POST") return handleRevisionPost(request, env.DB, user);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (url.pathname.startsWith("/api/v1/revisions/") && request.method === "GET") {
      const revisionId = decodeURIComponent(url.pathname.slice("/api/v1/revisions/".length));
      if (!isNonEmptyString(revisionId)) return json({ ok: false, error: "INVALID_REVISION_ID" }, 400);
      const row = await env.DB.prepare(`
        SELECT revision_id, protocol_version, revision_kind, session_id,
               sample_id, stage_id, sequence, content_hash, payload_json,
               created_at, received_at
        FROM sync_revisions WHERE revision_id = ?1 AND owner_user_id = ?2
      `).bind(revisionId, user.userId).first<Record<string, unknown>>();
      if (!row) return json({ ok: false, error: "REVISION_NOT_FOUND" }, 404);
      return json({ ok: true, revision: row });
    }

    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }
} satisfies ExportedHandler<Env>;
