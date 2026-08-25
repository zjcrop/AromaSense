import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthClientError,
  CloudflareAuthClient,
  type AuthSession,
  type AuthSessionStore,
  type PendingRegistration,
  type PendingRegistrationStore
} from "../app/core/auth-client";

class MemorySessionStore implements AuthSessionStore {
  value?: AuthSession;
  async get(): Promise<AuthSession | undefined> { return this.value; }
  async set(session: AuthSession): Promise<void> { this.value = session; }
  async clear(): Promise<void> { this.value = undefined; }
}

class MemoryPendingStore implements PendingRegistrationStore {
  value?: PendingRegistration;
  async get(): Promise<PendingRegistration | undefined> { return this.value; }
  async set(value: PendingRegistration): Promise<void> { this.value = value; }
  async clear(): Promise<void> { this.value = undefined; }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function withFetch<T>(implementation: typeof fetch, work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

test("registration stores pending verification state", async () => {
  const sessions = new MemorySessionStore();
  const pending = new MemoryPendingStore();
  const client = new CloudflareAuthClient("https://api.example.test", sessions, pending);

  await withFetch(async (input, init) => {
    assert.equal(String(input), "https://api.example.test/api/v1/auth/register");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { email: string; password: string };
    assert.equal(body.email, "user@example.com");
    return jsonResponse({ ok: true, status: "verification_required", email: body.email }, 202);
  }, async () => {
    const result = await client.register(" User@Example.com ", "0123456789");
    assert.deepEqual(result, { status: "verification_required", email: "user@example.com" });
    assert.equal((await client.pendingRegistration())?.email, "user@example.com");
  });
});

test("registration exposes missing email-service configuration without losing local usability", async () => {
  const client = new CloudflareAuthClient("https://api.example.test", new MemorySessionStore(), new MemoryPendingStore());

  await withFetch(async () => jsonResponse({ ok: false, error: "EMAIL_SERVICE_NOT_CONFIGURED" }, 503), async () => {
    await assert.rejects(
      () => client.register("user@example.com", "0123456789"),
      (error: unknown) => {
        assert.ok(error instanceof AuthClientError);
        assert.equal(error.code, "EMAIL_SERVICE_NOT_CONFIGURED");
        assert.equal(error.status, 503);
        assert.match(error.message, /验证邮件服务尚未配置/);
        return true;
      }
    );
  });
});

test("verified login persists the session and clears the matching pending registration", async () => {
  const sessions = new MemorySessionStore();
  const pending = new MemoryPendingStore();
  await pending.set({ email: "user@example.com", createdAt: "2026-08-25T07:00:00.000Z" });
  const client = new CloudflareAuthClient("https://api.example.test", sessions, pending);

  await withFetch(async (input) => {
    assert.equal(String(input), "https://api.example.test/api/v1/auth/login");
    return jsonResponse({
      ok: true,
      userId: "user-1",
      email: "user@example.com",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z"
    }, 200);
  }, async () => {
    const session = await client.login("user@example.com", "0123456789");
    assert.equal(session.userId, "user-1");
    assert.equal((await sessions.get())?.token, "token-1");
    assert.equal(await pending.get(), undefined);
  });
});
