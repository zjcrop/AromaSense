import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSession } from "../app/core/session-lifecycle";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { RecordSyncService } from "../app/core/record-sync-service";
import { SessionRecordService } from "../app/core/session-record-service";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");
const syncSchema = readFileSync("app/storage/0008_record_sync.sql", "utf8");
const syncStatusSchema = readFileSync("app/storage/0009_record_sync_status.sql", "utf8");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-record-sync-"));
  const db = NodeSQLiteDriver.open(join(dir, "sync.sqlite"));
  db.exec(schema);
  db.exec(syncSchema);
  db.exec(syncStatusSchema);
  const repository = new LocalCuppingRepository(db);
  return { dir, db, repository };
}

test("record delete writes a tombstone before removing the local session", async () => {
  const f = fixture();
  try {
    const createdAt = "2026-09-11T02:00:00.000Z";
    const deletedAt = "2026-09-11T02:05:00.000Z";
    const session = createSession({ sessionId: "record-delete", now: createdAt });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], createdAt, () => "sample-1");
    await f.repository.createSessionWithSamples(session, samples);

    await new SessionRecordService(f.repository, () => deletedAt).delete(session.sessionId);

    const sessionCount = await f.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?", [session.sessionId]
    );
    const tombstone = await f.db.get<{ deleted_at: string; last_pushed_at: string | null }>(
      "SELECT deleted_at, last_pushed_at FROM record_sync_state WHERE record_id = ?", [session.sessionId]
    );
    assert.equal(sessionCount?.count, 0);
    assert.equal(tombstone?.deleted_at, deletedAt);
    assert.equal(tombstone?.last_pushed_at, null);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("record sync uploads each changed session independently", async () => {
  const f = fixture();
  const previousFetch = globalThis.fetch;
  try {
    const updatedAt = "2026-09-11T03:00:00.000Z";
    const session = createSession({ sessionId: "record-push", now: updatedAt });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], updatedAt, () => "sample-1");
    await f.repository.createSessionWithSamples(session, samples);

    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({ method, url, body });
      if (method === "PUT") {
        return new Response(JSON.stringify({
          ok: true, applied: true, recordId: session.sessionId,
          updatedAt, serverChangedAt: "2026-09-11T03:00:01.000Z"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, records: [], nextCursor: 0, hasMore: false }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    };

    const result = await new RecordSyncService(f.db, "https://sync.example", async () => "token", () => updatedAt).sync();
    assert.equal(result.pushed, 1);
    assert.equal(result.failed, 0);
    const put = requests.find((item) => item.method === "PUT");
    assert.ok(put);
    assert.equal(put.body?.recordId, session.sessionId);
    assert.equal(put.body?.updatedAt, updatedAt);
    assert.equal((put.body?.payload as { session?: { sessionId?: string } })?.session?.sessionId, session.sessionId);
    const state = await f.db.get<{ last_pushed_at: string }>("SELECT last_pushed_at FROM record_sync_state WHERE record_id = ?", [session.sessionId]);
    assert.equal(state?.last_pushed_at, updatedAt);
  } finally {
    globalThis.fetch = previousFetch;
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("one failed record does not block later local records and persists only that failure", async () => {
  const f = fixture();
  const previousFetch = globalThis.fetch;
  try {
    const updatedAt = "2026-09-11T03:30:00.000Z";
    for (const sessionId of ["a-fails", "b-succeeds"]) {
      const session = createSession({ sessionId, now: updatedAt });
      const samples = buildSampleBatch(session.sessionId, [{ label: sessionId }], updatedAt, () => `${sessionId}-sample`);
      await f.repository.createSessionWithSamples(session, samples);
    }

    const putIds: string[] = [];
    globalThis.fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { recordId: string; updatedAt: string };
        putIds.push(body.recordId);
        if (body.recordId === "a-fails") {
          return new Response(JSON.stringify({ ok: false, error: "UPSTREAM_UNAVAILABLE" }), {
            status: 503, headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({
          ok: true, applied: true, recordId: body.recordId,
          updatedAt: body.updatedAt, serverChangedAt: "2026-09-11T03:30:01.000Z"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, records: [], nextCursor: 0, hasMore: false }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    };

    await assert.rejects(
      () => new RecordSyncService(f.db, "https://sync.example", async () => "token", () => updatedAt).sync(),
      /RECORD_SYNC_HTTP_503/
    );
    assert.deepEqual(putIds, ["a-fails", "b-succeeds"]);
    const failed = await f.db.get<{ error_message: string }>("SELECT error_message FROM record_sync_failures WHERE record_id = ?", ["a-fails"]);
    const succeededFailure = await f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM record_sync_failures WHERE record_id = ?", ["b-succeeds"]);
    const succeededState = await f.db.get<{ last_pushed_at: string }>("SELECT last_pushed_at FROM record_sync_state WHERE record_id = ?", ["b-succeeds"]);
    assert.match(failed?.error_message ?? "", /RECORD_SYNC_HTTP_503/);
    assert.equal(succeededFailure?.count, 0);
    assert.equal(succeededState?.last_pushed_at, updatedAt);
  } finally {
    globalThis.fetch = previousFetch;
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("remote deletion wins an equal timestamp and cannot resurrect from stale local data", async () => {
  const f = fixture();
  const previousFetch = globalThis.fetch;
  try {
    const timestamp = "2026-09-11T04:00:00.000Z";
    const session = createSession({ sessionId: "record-tie-delete", now: timestamp });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], timestamp, () => "sample-1");
    await f.repository.createSessionWithSamples(session, samples);
    await f.db.run(
      `INSERT INTO record_sync_state (record_id, last_pushed_at, deleted_at, updated_at) VALUES (?, ?, NULL, ?)`,
      [session.sessionId, timestamp, timestamp]
    );

    globalThis.fetch = async (_input, init) => {
      assert.notEqual(init?.method, "PUT");
      return new Response(JSON.stringify({
        ok: true,
        records: [{
          changeId: 1,
          recordId: session.sessionId,
          updatedAt: timestamp,
          deletedAt: timestamp,
          serverChangedAt: "2026-09-11T04:00:01.000Z"
        }],
        nextCursor: 1,
        hasMore: false
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await new RecordSyncService(f.db, "https://sync.example", async () => "token", () => timestamp).sync();
    assert.equal(result.deleted, 1);
    const remaining = await f.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?", [session.sessionId]
    );
    const tombstone = await f.db.get<{ deleted_at: string }>(
      "SELECT deleted_at FROM record_sync_state WHERE record_id = ?", [session.sessionId]
    );
    assert.equal(remaining?.count, 0);
    assert.equal(tombstone?.deleted_at, timestamp);
  } finally {
    globalThis.fetch = previousFetch;
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
