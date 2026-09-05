import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SensoryObservation } from "../shared/protocol/aromasense-v1";
import { completionForStage } from "../app/core/completion-engine";
import { deriveStageStatus } from "../app/core/cupping-progress-policy";
import { CuppingSessionController } from "../app/core/cupping-session-controller";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession } from "../app/core/session-lifecycle";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { StageProgressReader } from "../app/storage/stage-progress-reader";
import { CuppingScreenController } from "../app/ui/cupping-screen-controller";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");
const metadataMigration = readFileSync("app/storage/0002_session_metadata.sql", "utf8");
const timingMigration = readFileSync("app/storage/0005_session_timing.sql", "utf8");

function applySchema(db: NodeSQLiteDriver): void {
  db.exec(schema);
  db.exec(metadataMigration);
  db.exec(timingMigration);
}

function finalObservation(fieldKey: string, value: unknown): SensoryObservation {
  return {
    observationId: `obs:${fieldKey}`,
    sessionId: "legacy-session",
    sampleId: "legacy-sample",
    stageId: "final",
    fieldKey,
    value,
    dictionaryVersion: "sensory-0.1C",
    updatedAt: "2026-09-05T23:00:00+08:00"
  };
}

test("legacy final stage is complete when final score is confirmed even if earlier final phases are empty", () => {
  const observations = [finalObservation("final_score_confirmed", true)];
  const completion = completionForStage("final", observations);
  assert.equal(completion.complete, true);
  assert.deepEqual(completion.missing, []);
  assert.equal(deriveStageStatus("final", observations), "completed");
});

test("all sample score confirmations are the only session finish gate while earlier sensory stages remain incomplete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-score-gate-"));
  const db = NodeSQLiteDriver.open(join(dir, "score-gate.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-09-05T23:01:00+08:00";
    const session = createSession({ sessionId: "score-gate-session", now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "A" }, { label: "B" }],
      now,
      (() => {
        const ids = ["score-sample-1", "score-sample-2"];
        return () => ids.shift() ?? "unexpected-sample";
      })()
    );
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);
    await screen.initialize(session.sessionId, now);

    assert.equal(screen.canFinishSession(), false);

    await screen.select("score-sample-1", "scoring", "2026-09-05T23:01:10+08:00");
    await screen.saveField("score_confirmed", true, "2026-09-05T23:01:11+08:00");
    assert.equal(screen.canFinishSession(), false, "every sample must independently confirm its final score");
    assert.deepEqual(screen.current()?.lockedSampleIds, ["score-sample-1"]);

    const firstRail = screen.current()?.rail.find((item) => item.sampleId === "score-sample-1");
    assert.equal(firstRail?.stages.find((stage) => stage.stageId === "aroma")?.status, "not_started");
    assert.equal(firstRail?.stages.find((stage) => stage.stageId === "high_temp")?.status, "not_started");
    assert.equal(firstRail?.stages.find((stage) => stage.stageId === "scoring")?.status, "completed");

    await screen.select("score-sample-2", "scoring", "2026-09-05T23:01:20+08:00");
    await screen.saveField("score_confirmed", true, "2026-09-05T23:01:21+08:00");
    assert.equal(screen.canFinishSession(), true, "all final scores confirmed should enable whole-session completion");

    const beforeFinish = screen.current();
    for (const item of beforeFinish?.rail ?? []) {
      assert.equal(item.stages.find((stage) => stage.stageId === "aroma")?.status, "not_started");
      assert.equal(item.stages.find((stage) => stage.stageId === "mid_temp")?.status, "not_started");
      assert.equal(item.stages.find((stage) => stage.stageId === "scoring")?.status, "completed");
    }

    const completed = await screen.finishSession("2026-09-05T23:01:30+08:00");
    assert.equal(completed.sessionStatus, "completed");
    assert.equal(completed.sessionCompletedAt, "2026-09-05T23:01:30+08:00");

    for (const item of completed.rail) {
      assert.equal(item.stages.find((stage) => stage.stageId === "aroma")?.status, "not_started", "finish must not fabricate skipped-stage completion");
      assert.equal(item.stages.find((stage) => stage.stageId === "scoring")?.status, "completed");
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
