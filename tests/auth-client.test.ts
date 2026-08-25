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

test("registration is created in Firebase and stores pending verification state", async () => {
  const sessions = new MemorySessionStore();
  const pending = new MemoryPendingStore();
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", sessions, pending);
  const calls: string[] = [];

  await withFetch(async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method, "POST");
    if (url.includes("accounts:signUp")) {
      const body = JSON.parse(String(init?.body)) as { email: string; password: string };
      assert.equal(body.email, "user@example.com");
      assert.equal(body.password, "0123456789");
      return jsonResponse({ idToken: "firebase-id-token", email: body.email }, 200);
    }
    assert.match(url, /accounts:sendOobCode/);
    const body = JSON.parse(String(init?.body)) as { requestType: string; idToken: string };
    assert.equal(body.requestType, "VERIFY_EMAIL");
    assert.equal(body.idToken, "firebase-id-token");
    return jsonResponse({ email: "user@example.com" }, 200);
  }, async () => {
    const result = await client.register(" User@Example.com ", "0123456789");
    assert.deepEqual(result, { status: "verification_required", email: "user@example.com" });
    assert.equal((await client.pendingRegistration())?.email, "user@example.com");
  });

  assert.equal(calls.length, 2);
});

test("Firebase account-exists error is exposed without involving Cloudflare email service", async () => {
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), new MemoryPendingStore());

  await withFetch(async () => jsonResponse({ error: { message: "EMAIL_EXISTS" } }, 400), async () => {
    await assert.rejects(
      () => client.register("user@example.com", "0123456789"),
      (error: unknown) => {
        assert.ok(error instanceof AuthClientError);
        assert.equal(error.code, "ACCOUNT_EXISTS");
        assert.equal(error.status, 400);
        assert.match(error.message, /已注册/);
        return true;
      }
    );
  });
});

test("verified Firebase login exchanges the ID token for an AromaSense sync session", async () => {
  const sessions = new MemorySessionStore();
  const pending = new MemoryPendingStore();
  await pending.set({ email: "user@example.com", createdAt: "2026-08-25T07:00:00.000Z" });
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", sessions, pending);

  await withFetch(async (input, init) => {
    const url = String(input);
    if (url.includes("accounts:signInWithPassword")) {
      return jsonResponse({ idToken: "firebase-id-token", email: "user@example.com" }, 200);
    }
    assert.equal(url, "https://api.example.test/api/v1/auth/exchange");
    const body = JSON.parse(String(init?.body)) as { idToken: string };
    assert.equal(body.idToken, "firebase-id-token");
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

test("password reset uses Firebase and does not send mail through the Worker", async () => {
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), new MemoryPendingStore());
  await withFetch(async (input, init) => {
    assert.match(String(input), /accounts:sendOobCode/);
    const body = JSON.parse(String(init?.body)) as { requestType: string; email: string };
    assert.equal(body.requestType, "PASSWORD_RESET");
    assert.equal(body.email, "user@example.com");
    return jsonResponse({ email: body.email }, 200);
  }, async () => {
    await client.requestPasswordReset(" User@Example.com ");
  });
});
