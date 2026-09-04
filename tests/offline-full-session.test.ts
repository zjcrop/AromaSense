import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CuppingSessionController } from "../app/core/cupping-session-controller";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession, activateSession, completeSession } from "../app/core/session-lifecycle";
import { RevisionCheckpointService } from "../app/core/revision-checkpoint-service";
import type { SyncRepository, UploadRevisionResult } from "../app/core/sync-repository";
import { SyncEngine } from "../app/core/sync-engine";
import type { RevisionEnvelope } from "../shared/protocol/aromasense-v1";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SyncQueueStore } from "../app/storage/sync-queue-store";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

class RecoveringRemote implements SyncRepository {
  online = false;
  uploaded: string[] = [];
  async uploadRevision(revision: RevisionEnvelope): Promise<UploadRevisionResult> {
    if (!this.online) throw new Error("OFFLINE");
    this.uploaded.push(revision.revisionId);
    return { ok: true, revisionId: revision.revisionId, contentHash: revision.contentHash, status: "created" };
  }
  async getRevision(): Promise<RevisionEnvelope | null> { return null; }
}

test("full offline session remains local then synchronizes after network recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-offline-session-"));
  const db = NodeSQLiteDriver.open(join(dir, "offline.sqlite"));
  db.exec(schema);
  try {
    const repository = new LocalCuppingRepository(db);
    const queue = new SyncQueueStore(db);
    let id = 0;
    const revisions = new RevisionCheckpointService(db, repository, queue, {
      revisionId: () => `revision-${++id}`,
      queueId: () => `queue-${id}`
    });

    let session = createSession({ sessionId: "session-offline", now: "2026-08-24T22:00:00+08:00" });
    session = activateSession(session, "2026-08-24T22:00:01+08:00");
    const samples = buildSampleBatch(session.sessionId, [{ label: "Sample A" }], session.updatedAt, () => "sample-a");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, field) => `${context.sampleId}:${context.stageId}:${field}`);
    await editor.open({ sessionId: session.sessionId, sampleId: "sample-a", stageId: "high_temp" }, "2026-08-24T22:01:00+08:00");
    await editor.saveField("flavor_tags", ["jasmine"], "2026-08-24T22:01:05+08:00");
    await editor.saveField("acidity_intensity", 8.5, "2026-08-24T22:01:10+08:00");
    await editor.saveField("sweetness_intensity", 8, "2026-08-24T22:01:15+08:00");
    await editor.saveField("bitterness_intensity", 2, "2026-08-24T22:01:20+08:00");
    await editor.saveField("mouthfeel_intensity", 7, "2026-08-24T22:01:25+08:00");
    await editor.completeActiveStage("2026-08-24T22:02:00+08:00");
    await revisions.checkpointStage(session.sessionId, "sample-a", "high_temp", "2026-08-24T22:02:00+08:00");

    // This test is about durable offline revision/sync behavior rather than the
    // UI finish gate. Keep the existing direct final-state fixture so the
    // network recovery path remains isolated from the end-to-end workflow test.
    await repository.setStageState(session.sessionId, "sample-a", "final", "completed", "2026-08-24T22:03:00+08:00", "2026-08-24T22:03:00+08:00", "2026-08-24T22:03:00+08:00");
    session = completeSession(session, "2026-08-24T22:04:00+08:00");
    await repository.saveSession(session);
    await revisions.finalSession(session.sessionId, "2026-08-24T22:04:00+08:00");

    assert.equal((await queue.counts()).pending, 2);

    const remote = new RecoveringRemote();
    const fixedClock = { now: () => new Date("2026-08-24T14:05:00Z") };
    const engine = new SyncEngine(queue, remote, fixedClock, { maxBatch: 10, baseRetryMs: 1000 });

    const offline = await engine.runOnce();
    assert.equal(offline.failed, 2);
    assert.equal((await queue.counts()).failed, 2);
    assert.equal(remote.uploaded.length, 0);

    remote.online = true;
    const retryClock = { now: () => new Date("2026-08-24T14:06:00Z") };
    const retry = new SyncEngine(queue, remote, retryClock, { maxBatch: 10 });
    const recovered = await retry.runOnce();
    assert.equal(recovered.synced, 2);
    assert.equal((await queue.counts()).synced, 2);
    assert.deepEqual(remote.uploaded, ["revision-1", "revision-2"]);

    const stored = await repository.listObservationsForStage("sample-a", "high_temp");
    assert.equal(stored.find((item) => item.fieldKey === "acidity_intensity")?.value, 8.5);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
