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

function buildScreen(db: NodeSQLiteDriver, repository: LocalCuppingRepository): CuppingScreenController {
  const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
  return new CuppingScreenController(repository, new StageProgressReader(db), editor);
}

test("legacy final score confirmation remains readable after removing the runtime confirmation gate", () => {
  const observations = [finalObservation("final_score_confirmed", true)];
  const completion = completionForStage("final", observations);
  assert.equal(completion.complete, true);
  assert.deepEqual(completion.missing, []);
  assert.equal(deriveStageStatus("final", observations), "completed");
});

test("formal completion is an editable milestone and never locks an individual sample", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-formal-finish-"));
  const db = NodeSQLiteDriver.open(join(dir, "formal.sqlite"));
  applySchema(db);
  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-09-10T18:00:00+08:00";
    const session = createSession({
      sessionId: "formal-finish-session",
      now,
      metadata: { date: "2026-09-10", time: "18:00", organizer: "tester", cuppingMode: "formal" }
    });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }, { label: "B" }], now, (index) => `formal-sample-${index + 1}`);
    await repository.createSessionWithSamples(session, samples);
    const screen = buildScreen(db, repository);
    await screen.initialize(session.sessionId, now);

    assert.equal(screen.canFinishSession(), true);
    const completed = await screen.finishSession("2026-09-10T18:01:00+08:00");
    assert.equal(completed.sessionStatus, "active");
    assert.equal(completed.sessionCompletedAt, undefined);
    assert.equal(completed.sessionMetadata.completedEditableAt, "2026-09-10T18:01:00+08:00");
    assert.deepEqual(completed.lockedSampleIds, []);

    await screen.select("formal-sample-1", "aroma", "2026-09-10T18:01:10+08:00");
    const edited = await screen.saveField("notes", "完成后仍可继续补充", "2026-09-10T18:01:11+08:00");
    assert.equal(edited.active?.slice.observations.find((item) => item.fieldKey === "notes")?.value, "完成后仍可继续补充");
    assert.deepEqual(edited.lockedSampleIds, []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("competition starts explicitly and locks every sample only when the whole session finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-competition-finish-"));
  const db = NodeSQLiteDriver.open(join(dir, "competition.sqlite"));
  applySchema(db);
  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-09-10T18:10:00+08:00";
    const session = createSession({
      sessionId: "competition-finish-session",
      now,
      metadata: { date: "2026-09-10", time: "18:10", organizer: "tester", cuppingMode: "competition" }
    });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }, { label: "B" }], now, (index) => `competition-sample-${index + 1}`);
    await repository.createSessionWithSamples(session, samples);
    const screen = buildScreen(db, repository);
    await screen.initialize(session.sessionId, now);

    assert.equal(screen.canFinishSession(), false);
    await assert.rejects(() => screen.select("competition-sample-1", "aroma", now), /COMPETITION_NOT_STARTED/);
    const started = await screen.startCompetition("2026-09-10T18:10:05+08:00");
    assert.equal(started.sessionMetadata.competitionStartedAt, "2026-09-10T18:10:05+08:00");
    assert.deepEqual(started.lockedSampleIds, []);
    assert.equal(screen.canFinishSession(), true);

    const completed = await screen.finishSession("2026-09-10T18:40:05+08:00");
    assert.equal(completed.sessionStatus, "completed");
    assert.equal(completed.sessionCompletedAt, "2026-09-10T18:40:05+08:00");
    assert.equal(completed.sessionMetadata.competitionLockedAt, "2026-09-10T18:40:05+08:00");
    assert.deepEqual(completed.lockedSampleIds, ["competition-sample-1", "competition-sample-2"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
