export interface YingxiangHostUser {
  userId: string;
  email: string;
  accountId: string;
  accountName: string;
}

type JsonBody = Record<string, unknown>;

const HOST_TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000;
const DEVICE_SECRET_PATTERN = /^[a-f0-9]{64}$/iu;

function json(body: JsonBody, status = 200): Response {
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

function normalizeAccountName(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, "").trim()
    : "";
}

function accountKey(accountName: string): string {
  return accountName.toLocaleLowerCase("en-US");
}

function validAccountName(accountName: string): boolean {
  const length = Array.from(accountName).length;
  return length >= 2 && length <= 32 && !/[\\/]/u.test(accountName);
}

async function parseBody(request: Request): Promise<JsonBody | undefined> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as JsonBody : undefined;
  } catch {
    return undefined;
  }
}

async function deviceSecretHash(accountName: string, deviceSecret: string): Promise<string> {
  return sha256Hex(`yingxiang-host-device/1:${accountKey(accountName)}:${deviceSecret.toLowerCase()}`);
}

async function issueToken(db: D1Database, accountId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + HOST_TOKEN_LIFETIME_MS).toISOString();
  await db.batch([
    db.prepare("DELETE FROM yingxiang_host_tokens WHERE expires_at <= ?1").bind(now),
    db.prepare("INSERT INTO yingxiang_host_tokens (token_hash, account_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(tokenHash, accountId, expiresAt, now)
  ]);
  return { token, expiresAt };
}

export async function authenticateYingxiangHost(request: Request, db: D1Database): Promise<YingxiangHostUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!/^[a-f0-9]{64}$/iu.test(token)) return null;
  const tokenHash = await sha256Hex(token.toLowerCase());
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT a.account_id, a.account_name, a.owner_user_id, u.email
    FROM yingxiang_host_tokens t
    JOIN yingxiang_host_accounts a ON a.account_id = t.account_id
    JOIN users u ON u.user_id = a.owner_user_id
    WHERE t.token_hash = ?1 AND t.expires_at > ?2
  `).bind(tokenHash, now).first<{ account_id: string; account_name: string; owner_user_id: string; email: string }>();
  return row ? {
    userId: row.owner_user_id,
    email: row.email,
    accountId: row.account_id,
    accountName: row.account_name
  } : null;
}

async function register(request: Request, db: D1Database): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);
  const accountName = normalizeAccountName(body.accountName);
  const deviceSecret = typeof body.deviceSecret === "string" ? body.deviceSecret.trim().toLowerCase() : "";
  if (!validAccountName(accountName)) return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_NAME_INVALID" }, 400);
  if (!DEVICE_SECRET_PATTERN.test(deviceSecret)) return json({ ok: false, error: "YINGXIANG_HOST_DEVICE_SECRET_INVALID" }, 400);

  const key = accountKey(accountName);
  const existing = await db.prepare("SELECT account_id FROM yingxiang_host_accounts WHERE account_key = ?1").bind(key).first<{ account_id: string }>();
  if (existing) return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_EXISTS" }, 409);

  const accountId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const now = new Date().toISOString();
  const secretHash = await deviceSecretHash(accountName, deviceSecret);
  const internalEmail = `yingxiang+${accountId.replace(/-/gu, "")}@internal.invalid`;
  try {
    await db.batch([
      db.prepare(`INSERT INTO users
        (user_id, email, password_hash, password_salt, password_iterations, email_verified_at, created_at)
        VALUES (?1, ?2, 'yingxiang-device-bound', '', 0, ?3, ?3)`)
        .bind(ownerUserId, internalEmail, now),
      db.prepare(`INSERT INTO yingxiang_host_accounts
        (account_id, account_key, account_name, owner_user_id, device_secret_hash, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
        .bind(accountId, key, accountName, ownerUserId, secretHash, now)
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("unique")) return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_EXISTS" }, 409);
    return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_CREATE_FAILED" }, 500);
  }
  const auth = await issueToken(db, accountId);
  return json({ ok: true, accountId, accountName, ...auth }, 201);
}

async function login(request: Request, db: D1Database): Promise<Response> {
  const body = await parseBody(request);
  if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);
  const accountName = normalizeAccountName(body.accountName);
  const deviceSecret = typeof body.deviceSecret === "string" ? body.deviceSecret.trim().toLowerCase() : "";
  if (!validAccountName(accountName)) return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_NAME_INVALID" }, 400);
  if (!DEVICE_SECRET_PATTERN.test(deviceSecret)) return json({ ok: false, error: "YINGXIANG_HOST_DEVICE_SECRET_INVALID" }, 400);
  const row = await db.prepare(`SELECT account_id, account_name, device_secret_hash FROM yingxiang_host_accounts WHERE account_key = ?1`)
    .bind(accountKey(accountName)).first<{ account_id: string; account_name: string; device_secret_hash: string }>();
  if (!row) return json({ ok: false, error: "YINGXIANG_HOST_ACCOUNT_NOT_FOUND" }, 404);
  const secretHash = await deviceSecretHash(row.account_name, deviceSecret);
  if (secretHash !== row.device_secret_hash) return json({ ok: false, error: "YINGXIANG_HOST_DEVICE_MISMATCH" }, 403);
  await db.prepare("UPDATE yingxiang_host_accounts SET updated_at = ?1 WHERE account_id = ?2").bind(new Date().toISOString(), row.account_id).run();
  const auth = await issueToken(db, row.account_id);
  return json({ ok: true, accountId: row.account_id, accountName: row.account_name, ...auth });
}

async function logout(request: Request, db: D1Database): Promise<Response> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return json({ ok: true });
  const token = header.slice(7).trim();
  if (/^[a-f0-9]{64}$/iu.test(token)) {
    await db.prepare("DELETE FROM yingxiang_host_tokens WHERE token_hash = ?1").bind(await sha256Hex(token.toLowerCase())).run();
  }
  return json({ ok: true });
}

export async function handleYingxiangHostAuthRoute(request: Request, url: URL, db: D1Database): Promise<Response | undefined> {
  if (!url.pathname.startsWith("/api/v1/yingxiang/host/")) return undefined;
  if (url.pathname === "/api/v1/yingxiang/host/register" && request.method === "POST") return register(request, db);
  if (url.pathname === "/api/v1/yingxiang/host/login" && request.method === "POST") return login(request, db);
  if (url.pathname === "/api/v1/yingxiang/host/logout" && request.method === "POST") return logout(request, db);
  if (url.pathname === "/api/v1/yingxiang/host/me" && request.method === "GET") {
    const user = await authenticateYingxiangHost(request, db);
    return user ? json({ ok: true, accountId: user.accountId, accountName: user.accountName }) : json({ ok: false, error: "YINGXIANG_HOST_UNAUTHORIZED" }, 401);
  }
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
