import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession, activateSession, completeSession } from "../app/core/session-lifecycle";
import { RevisionCheckpointService } from "../app/core/revision-checkpoint-service";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SyncQueueStore } from "../app/storage/sync-queue-store";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-revision-"));
  const db = NodeSQLiteDriver.open(join(dir, "revision.sqlite"));
  db.exec(schema);
  const repository = new LocalCuppingRepository(db);
  const queue = new SyncQueueStore(db);
  let r = 0;
  let q = 0;
  const service = new RevisionCheckpointService(db, repository, queue, {
    revisionId: () => `revision-${++r}`,
    queueId: () => `queue-${++q}`
  });
  return { dir, db, repository, queue, service };
}

test("stage checkpoint persists immutable revision locally", async () => {
  const f = fixture();
  try {
    const now = "2026-08-24T21:40:00+08:00";
    let session = createSession({ sessionId: "s1", now });
    session = activateSession(session, now);
    const samples = buildSampleBatch("s1", [{ label: "A" }], now, () => "p1");
    await f.repository.createSessionWithSamples(session, samples);
    await f.repository.saveObservation({
      observationId: "o1", sessionId: "s1", sampleId: "p1", stageId: "high_temp",
      fieldKey: "acidity_intensity", value: 7, dictionaryVersion: "sensory-dictionary/1.0", updatedAt: now
    });
    const id = await f.service.checkpointStage("s1", "p1", "high_temp", now);
    assert.equal(id, "revision-1");
    assert.equal((await f.queue.counts()).pending, 1);
    const row = await f.db.get<{ revision_kind: string; sequence: number }>(
      "SELECT revision_kind, sequence FROM revisions WHERE revision_id = ?", [id]
    );
    assert.deepEqual(row, { revision_kind: "checkpoint", sequence: 0 });
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test("final revision requires completed session and increments sequence", async () => {
  const f = fixture();
  try {
    const now = "2026-08-24T21:41:00+08:00";
    let session = createSession({ sessionId: "s2", now });
    session = activateSession(session, now);
    const samples = buildSampleBatch("s2", [{ label: "A" }], now, () => "p2");
    await f.repository.createSessionWithSamples(session, samples);
    await f.service.checkpointStage("s2", "p2", "final", now);
    session = completeSession(session, "2026-08-24T21:42:00+08:00");
    await f.repository.saveSession(session);
    const finalId = await f.service.finalSession("s2", "2026-08-24T21:42:00+08:00");
    const row = await f.db.get<{ revision_kind: string; sequence: number }>(
      "SELECT revision_kind, sequence FROM revisions WHERE revision_id = ?", [finalId]
    );
    assert.deepEqual(row, { revision_kind: "final", sequence: 1 });
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
