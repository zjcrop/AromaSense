import { decodeProtectedHeader, importX509, jwtVerify, type JWTPayload } from "jose";

interface Env {
  DB?: D1Database;
  FIREBASE_PROJECT_ID?: string;
  PUBLIC_APP_URL?: string;
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

interface FirebaseIdentity {
  uid: string;
  email: string;
}

interface FirebaseCertificateCache {
  expiresAt: number;
  certificates: Record<string, string>;
  keys: Map<string, CryptoKey>;
}

const PRODUCT_VERSION = "B0.1.a";
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const FIREBASE_CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let firebaseCertificateCache: FirebaseCertificateCache | undefined;

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
  return json({ ok: false, error: "DB_NOT_CONFIGURED", message: "Cloudflare D1 binding 'DB' is not configured yet." }, 503);
}

function authUnavailable(): Response {
  return json({ ok: false, error: "FIREBASE_NOT_CONFIGURED", message: "FIREBASE_PROJECT_ID is not configured on the Worker." }, 503);
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
    typeof v.payload === "object" && v.payload !== null && !Array.isArray(v.payload) &&
    (v.sampleId === undefined || isNonEmptyString(v.sampleId)) &&
    (v.stageId === undefined || isNonEmptyString(v.stageId))
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function createAuthToken(db: D1Database, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  await db.prepare("INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(tokenHash, userId, expiresAt).run();
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
    WHERE t.token_hash = ?1 AND t.expires_at > ?2 AND u.email_verified_at IS NOT NULL
  `).bind(tokenHash, now).first<{ user_id: string; email: string }>();
  return row ? { userId: row.user_id, email: row.email } : null;
}

function parseMaxAge(cacheControl: string | null): number {
  const match = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : 300;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300_000;
}

async function firebasePublicKey(kid: string): Promise<CryptoKey> {
  const now = Date.now();
  if (!firebaseCertificateCache || firebaseCertificateCache.expiresAt <= now) {
    const response = await fetch(FIREBASE_CERT_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!response.ok) throw new Error(`FIREBASE_CERT_FETCH_FAILED_${response.status}`);
    const certificates = await response.json() as Record<string, string>;
    firebaseCertificateCache = {
      expiresAt: now + parseMaxAge(response.headers.get("cache-control")),
      certificates,
      keys: new Map()
    };
  }
  const cached = firebaseCertificateCache.keys.get(kid);
  if (cached) return cached;
  const certificate = firebaseCertificateCache.certificates[kid];
  if (!certificate) throw new Error("FIREBASE_UNKNOWN_KEY_ID");
  const key = await importX509(certificate, "RS256");
  firebaseCertificateCache.keys.set(kid, key);
  return key;
}

function validFirebasePayload(payload: JWTPayload, projectId: string): payload is JWTPayload & {
  sub: string;
  email: string;
  email_verified: true;
  auth_time: number;
} {
  const now = Math.floor(Date.now() / 1000);
  return (
    typeof payload.sub === "string" && payload.sub.length > 0 && payload.sub.length <= 128 &&
    typeof payload.email === "string" && payload.email.length > 2 && payload.email.length <= 254 &&
    payload.email_verified === true &&
    typeof payload.auth_time === "number" && payload.auth_time <= now + 60 &&
    payload.aud === projectId &&
    payload.iss === `https://securetoken.google.com/${projectId}`
  );
}

async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebaseIdentity> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256" || !header.kid) throw new Error("FIREBASE_INVALID_TOKEN_HEADER");
  const key = await firebasePublicKey(header.kid);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["RS256"],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`
  });
  if (!validFirebasePayload(payload, projectId)) {
    if (payload.email_verified !== true) throw new Error("EMAIL_NOT_VERIFIED");
    throw new Error("FIREBASE_INVALID_TOKEN_CLAIMS");
  }
  return { uid: payload.sub, email: payload.email.trim().toLowerCase() };
}

async function resolveOrCreateUser(db: D1Database, identity: FirebaseIdentity): Promise<AuthenticatedUser> {
  const linked = await db.prepare(`
    SELECT u.user_id, u.email
    FROM auth_identities i JOIN users u ON u.user_id = i.user_id
    WHERE i.provider = 'firebase' AND i.subject = ?1
  `).bind(identity.uid).first<{ user_id: string; email: string }>();
  const now = new Date().toISOString();
  if (linked) {
    if (linked.email !== identity.email) {
      const emailOwner = await db.prepare("SELECT user_id FROM users WHERE email = ?1").bind(identity.email)
        .first<{ user_id: string }>();
      if (!emailOwner || emailOwner.user_id === linked.user_id) {
        await db.prepare("UPDATE users SET email = ?1, email_verified_at = ?2 WHERE user_id = ?3")
          .bind(identity.email, now, linked.user_id).run();
      } else {
        await db.prepare("UPDATE users SET email_verified_at = ?1 WHERE user_id = ?2").bind(now, linked.user_id).run();
      }
    } else {
      await db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?1) WHERE user_id = ?2")
        .bind(now, linked.user_id).run();
    }
    await db.prepare("UPDATE auth_identities SET updated_at = ?1 WHERE provider = 'firebase' AND subject = ?2")
      .bind(now, identity.uid).run();
    return { userId: linked.user_id, email: identity.email };
  }

  const legacy = await db.prepare("SELECT user_id FROM users WHERE email = ?1").bind(identity.email)
    .first<{ user_id: string }>();
  const userId = legacy?.user_id ?? crypto.randomUUID();
  if (legacy) {
    await db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?1) WHERE user_id = ?2")
      .bind(now, userId).run();
  } else {
    await db.prepare(`
      INSERT INTO users (user_id, email, password_hash, password_salt, password_iterations, email_verified_at)
      VALUES (?1, ?2, 'firebase-managed', '', 0, ?3)
    `).bind(userId, identity.email, now).run();
  }
  await db.prepare(`
    INSERT INTO auth_identities (provider, subject, user_id, created_at, updated_at)
    VALUES ('firebase', ?1, ?2, ?3, ?3)
  `).bind(identity.uid, userId, now).run();
  return { userId, email: identity.email };
}

async function handleExchange(request: Request, env: Env): Promise<Response> {
  if (!env.FIREBASE_PROJECT_ID) return authUnavailable();
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const idToken = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).idToken === "string"
    ? String((body as Record<string, unknown>).idToken).trim()
    : "";
  if (!idToken || idToken.length > 8192) return json({ ok: false, error: "INVALID_FIREBASE_TOKEN" }, 401);

  let identity: FirebaseIdentity;
  try {
    identity = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FIREBASE_TOKEN_VERIFICATION_FAILED";
    if (code === "EMAIL_NOT_VERIFIED") return json({ ok: false, error: "EMAIL_NOT_VERIFIED" }, 403);
    return json({ ok: false, error: "INVALID_FIREBASE_TOKEN" }, 401);
  }

  try {
    const user = await resolveOrCreateUser(env.DB!, identity);
    const auth = await createAuthToken(env.DB!, user.userId);
    return json({ ok: true, userId: user.userId, email: user.email, ...auth });
  } catch (error) {
    return json({ ok: false, error: "AUTH_EXCHANGE_FAILED", message: error instanceof Error ? error.message : "Unknown database error" }, 500);
  }
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
  const existing = await db.prepare("SELECT content_hash, owner_user_id FROM sync_revisions WHERE revision_id = ?1")
    .bind(body.revisionId).first<{ content_hash: string; owner_user_id: string | null }>();
  if (existing) {
    if (existing.owner_user_id !== user.userId) return json({ ok: false, error: "REVISION_NOT_FOUND" }, 404);
    if (existing.content_hash === body.contentHash) return json({ ok: true, revisionId: body.revisionId, contentHash: body.contentHash, status: "already_present" });
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
      return json({
        ok: true,
        service: "aromasense-api",
        version: PRODUCT_VERSION,
        protocol: "aromasense-sync/1.0",
        database: env.DB ? "configured" : "not-configured",
        authentication: env.FIREBASE_PROJECT_ID ? "firebase-configured" : "not-configured",
        timestamp: new Date().toISOString()
      });
    }

    if (!env.DB) return dbUnavailable();
    if (url.pathname === "/api/v1/auth/exchange" && request.method === "POST") return handleExchange(request, env);
    if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") return handleLogout(request, env.DB);

    if (url.pathname.startsWith("/api/v1/auth/") && request.method !== "OPTIONS") {
      return json({ ok: false, error: "AUTH_PROVIDER_MIGRATED", provider: "firebase" }, 410);
    }

    const user = await authenticate(request, env.DB);
    if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

    if (url.pathname === "/api/v1/auth/me" && request.method === "GET") return json({ ok: true, userId: user.userId, email: user.email });

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
