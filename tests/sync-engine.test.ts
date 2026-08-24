import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RevisionEnvelope } from "../shared/protocol/aromasense-v1";
import { buildRevision } from "../app/core/revision-builder";
import type { SyncRepository, UploadRevisionResult } from "../app/core/sync-repository";
import { SyncEngine } from "../app/core/sync-engine";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SyncQueueStore } from "../app/storage/sync-queue-store";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

class FakeRemote implements SyncRepository {
  public uploads = 0;
  constructor(private readonly mode: "ok" | "already" | "fail" | "conflict" = "ok") {}
  async uploadRevision(revision: RevisionEnvelope): Promise<UploadRevisionResult> {
    this.uploads += 1;
    if (this.mode === "fail") throw new Error("NETWORK_DOWN");
    if (this.mode === "conflict") {
      return { ok: false, error: "REVISION_CONFLICT", revisionId: revision.revisionId, existingHash: "different" };
    }
    return {
      ok: true,
      revisionId: revision.revisionId,
      contentHash: revision.contentHash,
      status: this.mode === "already" ? "already_present" : "created"
    };
  }
  async getRevision(): Promise<RevisionEnvelope | null> { return null; }
}

async function revision(id: string, sequence: number): Promise<RevisionEnvelope> {
  return buildRevision({
    revisionId: id,
    revisionKind: "checkpoint",
    sessionId: "s1",
    sampleId: "p1",
    stageId: "high_temp",
    sequence,
    createdAt: "2026-08-24T21:30:00+08:00",
    payload: { value: sequence }
  });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-sync-"));
  const db = NodeSQLiteDriver.open(join(dir, "sync.sqlite"));
  db.exec(schema);
  return { dir, db, queue: new SyncQueueStore(db) };
}

test("sync engine uploads pending revision and marks it synced", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue(await revision("r1", 0), "q1", "2026-08-24T21:30:00+08:00");
    const remote = new FakeRemote("ok");
    const engine = new SyncEngine(f.queue, remote, { now: () => new Date("2026-08-24T13:31:00Z") });
    const result = await engine.runOnce();
    assert.deepEqual(result, { attempted: 1, synced: 1, conflicted: 0, failed: 0 });
    assert.equal((await f.queue.counts()).synced, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("already-present ACK is treated as successful idempotent retry", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue(await revision("r-idempotent", 0), "q-idempotent", "2026-08-24T21:30:00+08:00");
    const remote = new FakeRemote("already");
    const engine = new SyncEngine(f.queue, remote, { now: () => new Date("2026-08-24T13:31:00Z") });
    const result = await engine.runOnce();
    assert.equal(result.synced, 1);
    assert.equal(result.conflicted, 0);
    assert.equal((await f.queue.counts()).synced, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("network failure remains durable and receives retry time", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue(await revision("r2", 0), "q2", "2026-08-24T21:30:00+08:00");
    const engine = new SyncEngine(f.queue, new FakeRemote("fail"), { now: () => new Date("2026-08-24T13:31:00Z") }, { baseRetryMs: 1000 });
    const result = await engine.runOnce();
    assert.equal(result.failed, 1);
    assert.equal((await f.queue.counts()).failed, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("server revision conflict is terminal and never overwritten", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue(await revision("r3", 0), "q3", "2026-08-24T21:30:00+08:00");
    const engine = new SyncEngine(f.queue, new FakeRemote("conflict"), { now: () => new Date("2026-08-24T13:31:00Z") });
    const result = await engine.runOnce();
    assert.equal(result.conflicted, 1);
    assert.equal((await f.queue.counts()).conflict, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("interrupted uploading row is recovered after restart", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue(await revision("r4", 0), "q4", "2026-08-24T21:30:00+08:00");
    await f.queue.claimReady("2026-08-24T21:31:00+08:00");
    assert.equal((await f.queue.counts()).uploading, 1);
    await f.queue.recoverInterrupted("2026-08-24T21:32:00+08:00");
    assert.equal((await f.queue.counts()).failed, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
