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
    assert.equal(init?.cache, "no-store");
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
    assert.deepEqual(result, { status: "verification_required", email: "user@example.com", verificationEmail: "sent" });
    assert.equal((await client.pendingRegistration())?.email, "user@example.com");
  });

  assert.equal(calls.length, 2);
});

test("account creation remains successful when verification email delivery times out", async () => {
  const pending = new MemoryPendingStore();
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), pending, 15);
  let call = 0;

  await withFetch(async (_input, init) => {
    call += 1;
    if (call === 1) return jsonResponse({ idToken: "firebase-id-token", email: "user@example.com" }, 200);
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }, async () => {
    const result = await client.register("user@example.com", "0123456789");
    assert.deepEqual(result, {
      status: "verification_required",
      email: "user@example.com",
      verificationEmail: "retry_required"
    });
    assert.equal((await pending.get())?.email, "user@example.com");
  });
});

test("retrying registration recovers an existing unverified Firebase account instead of trapping on EMAIL_EXISTS", async () => {
  const pending = new MemoryPendingStore();
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), pending);
  const paths: string[] = [];

  await withFetch(async (input) => {
    const url = String(input);
    paths.push(url);
    if (url.includes("accounts:signUp")) return jsonResponse({ error: { message: "EMAIL_EXISTS" } }, 400);
    if (url.includes("accounts:signInWithPassword")) return jsonResponse({ idToken: "existing-token", email: "user@example.com" }, 200);
    if (url.includes("accounts:lookup")) return jsonResponse({ users: [{ email: "user@example.com", emailVerified: false }] }, 200);
    if (url.includes("accounts:sendOobCode")) return jsonResponse({ email: "user@example.com" }, 200);
    throw new Error(`Unexpected request ${url}`);
  }, async () => {
    const result = await client.register("user@example.com", "0123456789");
    assert.deepEqual(result, { status: "verification_required", email: "user@example.com", verificationEmail: "sent" });
    assert.equal((await pending.get())?.email, "user@example.com");
  });

  assert.equal(paths.length, 4);
});

test("concurrent registration submissions for the same email share one Firebase request chain", async () => {
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), new MemoryPendingStore());
  let signupCalls = 0;
  let verificationCalls = 0;

  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes("accounts:signUp")) {
      signupCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse({ idToken: "firebase-id-token", email: "user@example.com" }, 200);
    }
    verificationCalls += 1;
    return jsonResponse({ email: "user@example.com" }, 200);
  }, async () => {
    const [left, right] = await Promise.all([
      client.register("user@example.com", "0123456789"),
      client.register("user@example.com", "0123456789")
    ]);
    assert.deepEqual(left, right);
  });

  assert.equal(signupCalls, 1);
  assert.equal(verificationCalls, 1);
});

test("Firebase account-exists error is exposed when the existing account cannot be recovered with the supplied password", async () => {
  const client = new CloudflareAuthClient("https://api.example.test", "firebase-key", new MemorySessionStore(), new MemoryPendingStore());
  let call = 0;

  await withFetch(async () => {
    call += 1;
    if (call === 1) return jsonResponse({ error: { message: "EMAIL_EXISTS" } }, 400);
    return jsonResponse({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }, 400);
  }, async () => {
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

test("account requests abort instead of waiting indefinitely", async () => {
  const client = new CloudflareAuthClient(
    "https://api.example.test",
    "firebase-key",
    new MemorySessionStore(),
    new MemoryPendingStore(),
    15
  );

  await withFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal, "auth request must carry an AbortSignal");
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }), async () => {
    await assert.rejects(
      () => client.login("user@example.com", "0123456789"),
      (error: unknown) => {
        assert.ok(error instanceof AuthClientError);
        assert.equal(error.code, "NETWORK_TIMEOUT");
        assert.match(error.message, /超时/);
        return true;
      }
    );
  });
});
