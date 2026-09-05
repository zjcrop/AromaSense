import assert from "node:assert/strict";
import test from "node:test";
import { YingxiangClient, YingxiangClientError } from "../app/core/yingxiang-client";
import { defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("owner event creation requires an auth token before network access", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return response({ ok: true }); };
  try {
    const client = new YingxiangClient("https://example.test", async () => undefined);
    await assert.rejects(
      () => client.createEvent({ title: "测试", policy: defaultYingxiangEventPolicy() }),
      (error: unknown) => error instanceof YingxiangClientError && error.code === "UNAUTHORIZED"
    );
    assert.equal(called, false);
  } finally { globalThis.fetch = original; }
});

test("guest invite join is allowed without Authorization header", async () => {
  const original = globalThis.fetch;
  let authorization: string | null = "unexpected";
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    body = JSON.parse(String(init?.body));
    return response({
      ok: true,
      principal: {
        schemaVersion: "yingxiang-principal/0.1", participantId: "p1", eventId: "e1", identityKind: "guest",
        displayName: "访客01", accountDisplayNameHidden: true, status: "active", boundAt: "now"
      },
      event: {
        schemaVersion: "yingxiang-event/0.1", eventId: "e1", eventRevision: 1, title: "测试", status: "published",
        policy: defaultYingxiangEventPolicy(), createdAt: "now", updatedAt: "now"
      }
    }, 201);
  };
  try {
    const client = new YingxiangClient("https://example.test", async () => undefined);
    const joined = await client.joinInvite("a".repeat(48), { displayName: "访客01", nameSource: "custom" });
    assert.equal(authorization, null);
    assert.deepEqual(body, { displayName: "访客01", nameSource: "custom" });
    assert.equal(joined.principal.identityKind, "guest");
  } finally { globalThis.fetch = original; }
});

test("logged-in invite join preserves optional account binding without exposing account name automatically", async () => {
  const original = globalThis.fetch;
  let authorization: string | null = null;
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return response({
      ok: true,
      principal: {
        schemaVersion: "yingxiang-principal/0.1", participantId: "p1", eventId: "e1", identityKind: "account", accountUserId: "u1",
        displayName: "盲测07", accountDisplayNameHidden: true, status: "active", boundAt: "now"
      },
      event: {
        schemaVersion: "yingxiang-event/0.1", eventId: "e1", eventRevision: 1, title: "测试", status: "published",
        policy: defaultYingxiangEventPolicy(), createdAt: "now", updatedAt: "now"
      }
    }, 201);
  };
  try {
    const client = new YingxiangClient("https://example.test", async () => "token-1");
    const joined = await client.joinInvite("b".repeat(48), { displayName: "盲测07", nameSource: "custom" });
    assert.equal(authorization, "Bearer token-1");
    assert.equal(joined.principal.displayName, "盲测07");
    assert.equal(joined.principal.accountDisplayNameHidden, true);
  } finally { globalThis.fetch = original; }
});

test("host invite creation uses event-scoped endpoint and bearer auth", async () => {
  const original = globalThis.fetch;
  let url = "";
  let authorization: string | null = null;
  globalThis.fetch = async (input, init) => {
    url = String(input);
    authorization = new Headers(init?.headers).get("authorization");
    return response({ ok: true, inviteId: "i1", eventId: "event 1", eventRevision: 1, token: "c".repeat(48), expiresAt: "later", maxUses: 1, share: { deepLink: "x" } }, 201);
  };
  try {
    const client = new YingxiangClient("https://example.test/base", async () => "token-2");
    await client.createInvite("event 1", { maxUses: 1 });
    assert.equal(new URL(url).pathname, "/api/v1/yingxiang/events/event%201/invites");
    assert.equal(authorization, "Bearer token-2");
  } finally { globalThis.fetch = original; }
});
