interface Env {
  DB?: D1Database;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
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

const PRODUCT_VERSION = "B0.1.a";
const PASSWORD_ITERATIONS = 160_000;
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RESEND_MS = 60 * 1000;

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

function isNonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
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
    typeof v.payload === "object" && v.payload !== null && !Array.isArray(v.payload) &&
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
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
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

function verificationHtml(title: string, message: string, appUrl?: string, success = true): Response {
  const safe = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const link = appUrl
    ? `<a href="${safe(appUrl)}" style="display:inline-block;margin-top:18px;padding:10px 16px;border-radius:10px;background:#b9995a;color:#111;text-decoration:none;font-weight:700">返回 AromaSense</a>`
    : "";
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><body style="margin:0;background:#151515;color:#f4efe4;font-family:system-ui"><main style="max-width:520px;margin:14vh auto;padding:24px"><h1 style="color:${success ? "#b9995a" : "#e89a55"}">${safe(title)}</h1><p style="line-height:1.7;color:#bbb3a7">${safe(message)}</p>${link}</main></body></html>`, {
    status: success ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

async function sendVerificationEmail(env: Env, request: Request, email: string, token: string): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new Error("EMAIL_SERVICE_NOT_CONFIGURED");
  const verifyUrl = new URL("/api/v1/auth/verify", request.url);
  verifyUrl.searchParams.set("token", token);
  const text = `AromaSense · 香迹账户验证\n\n注册信息已提交。请打开以下链接激活账户：\n${verifyUrl.toString()}\n\n链接 24 小时内有效且仅可使用一次。若非本人操作，请忽略本邮件。`;
  const html = `<div style="font-family:system-ui;line-height:1.7;color:#222"><h2>AromaSense · 香迹账户验证</h2><p>注册信息已提交。请点击下方按钮激活账户，激活后返回 AromaSense 使用相同邮箱和密码登录。</p><p><a href="${verifyUrl.toString()}" style="display:inline-block;padding:10px 16px;border-radius:9px;background:#b9995a;color:#111;text-decoration:none;font-weight:700">激活 AromaSense 账户</a></p><p style="color:#666;font-size:12px">链接 24 小时内有效且仅可使用一次。若非本人操作，请忽略本邮件。</p></div>`;
  await env.EMAIL.send({
    to: email,
    from: env.EMAIL_FROM,
    subject: "激活你的 AromaSense · 香迹账户",
    text,
    html
  });
}

async function issueVerification(db: D1Database, env: Env, request: Request, userId: string, email: string): Promise<void> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + VERIFICATION_LIFETIME_MS).toISOString();
  await db.batch([
    db.prepare("UPDATE email_verification_tokens SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL").bind(now, userId),
    db.prepare("INSERT INTO email_verification_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)").bind(tokenHash, userId, expiresAt),
    db.prepare("UPDATE users SET verification_last_sent_at = ?1 WHERE user_id = ?2").bind(now, userId)
  ]);
  await sendVerificationEmail(env, request, email, token);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const db = env.DB!;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (typeof body !== "object" || body === null) return json({ ok: false, error: "INVALID_PAYLOAD" }, 400);
  const value = body as Record<string, unknown>;
  const email = normalizeEmail(value.email);
  const password = typeof value.password === "string" ? value.password : "";
  if (!email || password.length < 10 || password.length > 256) return json({ ok: false, error: "INVALID_CREDENTIALS_FORMAT" }, 400);
  if (!env.EMAIL || !env.EMAIL_FROM) return json({ ok: false, error: "EMAIL_SERVICE_NOT_CONFIGURED" }, 503);

  const existing = await db.prepare("SELECT user_id, email_verified_at FROM users WHERE email = ?1").bind(email)
    .first<{ user_id: string; email_verified_at: string | null }>();
  if (existing) {
    return json({ ok: false, error: existing.email_verified_at ? "ACCOUNT_EXISTS" : "ACCOUNT_PENDING_VERIFICATION", email }, 409);
  }

  const userId = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await passwordHash(password, salt, PASSWORD_ITERATIONS);
  await db.prepare(`
    INSERT INTO users (user_id, email, password_hash, password_salt, password_iterations, email_verified_at)
    VALUES (?1, ?2, ?3, ?4, ?5, NULL)
  `).bind(userId, email, hash, salt, PASSWORD_ITERATIONS).run();

  try {
    await issueVerification(db, env, request, userId, email);
  } catch (error) {
    return json({ ok: false, error: "VERIFICATION_EMAIL_FAILED", message: error instanceof Error ? error.message : "Unknown email error" }, 502);
  }
  return json({ ok: true, status: "verification_required", email }, 202);
}

async function handleResendVerification(request: Request, env: Env): Promise<Response> {
  const db = env.DB!;
  if (!env.EMAIL || !env.EMAIL_FROM) return json({ ok: false, error: "EMAIL_SERVICE_NOT_CONFIGURED" }, 503);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const email = normalizeEmail(typeof body === "object" && body !== null ? (body as Record<string, unknown>).email : undefined);
  if (!email) return json({ ok: false, error: "INVALID_EMAIL" }, 400);
  const row = await db.prepare("SELECT user_id, email_verified_at, verification_last_sent_at FROM users WHERE email = ?1").bind(email)
    .first<{ user_id: string; email_verified_at: string | null; verification_last_sent_at: string | null }>();
  if (!row) return json({ ok: true, status: "verification_requested", email }, 202);
  if (row.email_verified_at) return json({ ok: false, error: "ACCOUNT_ALREADY_VERIFIED" }, 409);
  const lastSent = row.verification_last_sent_at ? Date.parse(row.verification_last_sent_at) : 0;
  const remainingMs = Math.max(0, lastSent + VERIFICATION_RESEND_MS - Date.now());
  if (remainingMs > 0) return json({ ok: false, error: "VERIFICATION_RATE_LIMITED", retryAfterSeconds: Math.ceil(remainingMs / 1000) }, 429);
  try {
    await issueVerification(db, env, request, row.user_id, email);
  } catch (error) {
    return json({ ok: false, error: "VERIFICATION_EMAIL_FAILED", message: error instanceof Error ? error.message : "Unknown email error" }, 502);
  }
  return json({ ok: true, status: "verification_sent", email }, 202);
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const db = env.DB!;
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token || token.length > 256) return verificationHtml("激活链接无效", "验证链接缺少有效凭据，请返回 AromaSense 重新发送验证邮件。", env.PUBLIC_APP_URL, false);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT t.user_id, t.expires_at, t.used_at, u.email_verified_at
    FROM email_verification_tokens t
    JOIN users u ON u.user_id = t.user_id
    WHERE t.token_hash = ?1
  `).bind(tokenHash).first<{ user_id: string; expires_at: string; used_at: string | null; email_verified_at: string | null }>();
  if (!row) return verificationHtml("激活链接无效", "无法识别此验证链接，请返回 AromaSense 重新发送验证邮件。", env.PUBLIC_APP_URL, false);
  if (row.email_verified_at) return verificationHtml("账户已经激活", "此账户已经完成邮箱验证，可以直接返回 AromaSense 登录。", env.PUBLIC_APP_URL, true);
  if (row.used_at || Date.parse(row.expires_at) <= Date.now()) return verificationHtml("激活链接已失效", "验证链接已经使用或超过 24 小时，请返回 AromaSense 重新发送验证邮件。", env.PUBLIC_APP_URL, false);
  await db.batch([
    db.prepare("UPDATE users SET email_verified_at = ?1 WHERE user_id = ?2 AND email_verified_at IS NULL").bind(now, row.user_id),
    db.prepare("UPDATE email_verification_tokens SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL").bind(now, row.user_id)
  ]);
  return verificationHtml("账户激活成功", "邮箱验证已完成。现在可以返回 AromaSense，使用注册邮箱和密码登录。", env.PUBLIC_APP_URL, true);
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
    SELECT user_id, email, password_hash, password_salt, password_iterations, email_verified_at
    FROM users WHERE email = ?1
  `).bind(email).first<{
    user_id: string; email: string; password_hash: string; password_salt: string; password_iterations: number; email_verified_at: string | null;
  }>();
  if (!row) return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
  const candidate = await passwordHash(password, row.password_salt, row.password_iterations);
  if (!constantTimeEqual(candidate, row.password_hash)) return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
  if (!row.email_verified_at) return json({ ok: false, error: "EMAIL_NOT_VERIFIED", email: row.email }, 403);
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
        email: env.EMAIL && env.EMAIL_FROM ? "configured" : "not-configured",
        timestamp: new Date().toISOString()
      });
    }

    if (!env.DB) return dbUnavailable();

    if (url.pathname === "/api/v1/auth/register" && request.method === "POST") return handleRegister(request, env);
    if (url.pathname === "/api/v1/auth/resend-verification" && request.method === "POST") return handleResendVerification(request, env);
    if (url.pathname === "/api/v1/auth/verify" && request.method === "GET") return handleVerify(request, env);
    if (url.pathname === "/api/v1/auth/login" && request.method === "POST") return handleLogin(request, env.DB);
    if (url.pathname === "/api/v1/auth/logout" && request.method === "POST") return handleLogout(request, env.DB);

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
