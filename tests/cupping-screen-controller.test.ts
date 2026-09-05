import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { StageId } from "../shared/protocol/aromasense-v1";
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

async function fillRequiredStage(screen: CuppingScreenController, sampleId: string, stageId: StageId, now: string): Promise<void> {
  await screen.select(sampleId, stageId, now);
  const fields: Record<StageId, ReadonlyArray<[string, unknown]>> = {
    preparation: [["dry_fragrance_intensity", 6]],
    aroma: [["wet_aroma_intensity", 7], ["flavor_tags", ["jasmine"]]],
    high_temp: [
      ["flavor_tags", ["jasmine"]], ["acidity_intensity", 8], ["sweetness_intensity", 8],
      ["bitterness_intensity", 2], ["mouthfeel_intensity", 7]
    ],
    mid_temp: [
      ["flavor_tags", ["jasmine"]], ["acidity_intensity", 7], ["sweetness_intensity", 8],
      ["bitterness_intensity", 2], ["mouthfeel_intensity", 7], ["finish_intensity", 8]
    ],
    low_temp: [
      ["flavor_tags", ["jasmine"]], ["acidity_intensity", 6], ["sweetness_intensity", 7],
      ["bitterness_intensity", 2], ["mouthfeel_intensity", 6], ["finish_intensity", 7]
    ],
    flavor: [["flavor_tags", ["jasmine"]]],
    overall: [
      ["quality_flavor", 8], ["quality_aftertaste", 8], ["quality_acidity", 8], ["quality_sweetness", 8],
      ["quality_body", 8], ["quality_clean", 8], ["quality_uniformity", 8], ["quality_balance", 8]
    ],
    scoring: [["score_confirmed", true]],
    final: [
      ["flavor_tags", ["jasmine"]],
      ["quality_flavor", 8], ["quality_aftertaste", 8], ["quality_acidity", 8], ["quality_sweetness", 8],
      ["quality_body", 8], ["quality_clean", 8], ["quality_uniformity", 8], ["quality_balance", 8],
      ["final_score_confirmed", true]
    ]
  };

  for (const [fieldKey, value] of fields[stageId]) await screen.saveField(fieldKey, value, now);
}

function applySchema(db: NodeSQLiteDriver): void {
  db.exec(schema);
  db.exec(metadataMigration);
  db.exec(timingMigration);
}

test("entering the cupping screen starts the session clock while browsing alone does not start a sensory step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-screen-"));
  const db = NodeSQLiteDriver.open(join(dir, "screen.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const createdAt = "2026-08-24T20:39:00+08:00";
    const enteredAt = "2026-08-24T20:40:00+08:00";
    const session = createSession({ sessionId: "screen-session", now: createdAt });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], createdAt, () => "sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);

    await screen.initialize(session.sessionId, enteredAt);
    assert.equal(screen.current()?.sessionStatus, "active");
    assert.equal(screen.current()?.sessionStartedAt, enteredAt);
    assert.equal((await repository.getSession(session.sessionId)).startedAt, enteredAt);

    for (const stage of ["aroma", "high_temp", "mid_temp", "low_temp", "flavor", "overall", "scoring"] as const) {
      await screen.select("sample-1", stage, enteredAt);
      assert.equal(screen.current()?.sessionStatus, "active");
      assert.equal((await repository.getSession(session.sessionId)).status, "active");
      assert.equal(screen.current()?.rail[0]?.stages.find((item) => item.stageId === stage)?.status, "not_started");
    }

    await screen.select("sample-1", "aroma", enteredAt);
    await screen.saveField("notes", "   ", "2026-08-24T20:40:10+08:00");
    assert.equal((await repository.listStageStates(session.sessionId)).find((stage) => stage.stageId === "aroma")?.startedAt, undefined);
    await screen.saveField("notes", "花香逐渐展开", "2026-08-24T20:40:20+08:00");
    assert.equal(screen.current()?.active?.slice.stageStatus, "active");
    assert.equal((await repository.listStageStates(session.sessionId)).find((stage) => stage.stageId === "aroma")?.startedAt, "2026-08-24T20:40:20+08:00");

    await screen.leaveSession();
    await screen.initialize(session.sessionId, "2026-08-24T20:40:25+08:00");
    assert.equal(screen.current()?.sessionStartedAt, enteredAt, "re-entering must not reset the session clock");
    await screen.select("sample-1", "aroma", "2026-08-24T20:40:25+08:00");
    assert.equal(screen.current()?.active?.slice.observations.find((item) => item.fieldKey === "notes")?.value, "花香逐渐展开");
    await screen.saveField("wet_aroma_intensity", 7, "2026-08-24T20:40:30+08:00");
    assert.equal(screen.current()?.rail[0]?.stages.find((stage) => stage.stageId === "aroma")?.status, "active");
    await assert.rejects(() => screen.goNext("2026-08-24T20:40:40+08:00"), /STAGE_INCOMPLETE:aroma/);
    await screen.saveField("flavor_tags", ["jasmine"], "2026-08-24T20:40:50+08:00");
    const afterNext = await screen.goNext("2026-08-24T20:41:00+08:00");

    assert.equal(afterNext.active?.context.stageId, "high_temp");
    const aroma = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "aroma");
    const high = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "high_temp");
    assert.equal(aroma?.status, "completed");
    assert.equal(afterNext.progress.find((item) => item.sampleId === "sample-1" && item.stageId === "aroma")?.completedAt, "2026-08-24T20:41:00+08:00");
    assert.equal(high?.status, "not_started");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blind identity edits persist during a browsed stage while rail identity remains hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-blind-identity-"));
  const db = NodeSQLiteDriver.open(join(dir, "blind.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-27T11:20:00+08:00";
    const session = createSession({
      sessionId: "blind-session",
      now,
      metadata: { date: "2026-08-27", time: "11:20", organizer: "tester", cuppingMode: "blind" }
    });
    const samples = buildSampleBatch(session.sessionId, [{}], now, () => "blind-sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);

    await screen.initialize(session.sessionId, now);
    await screen.select("blind-sample-1", "mid_temp", now);
    const updated = await screen.saveSampleIdentity(
      "blind-sample-1",
      "Ethiopia Guji Lot 12",
      { country: "Ethiopia", region: "Guji", process: "Washed", roast: "Light" },
      "2026-08-27T11:21:00+08:00"
    );

    assert.equal(updated.samples[0]?.label, "Ethiopia Guji Lot 12");
    assert.equal(updated.samples[0]?.metadata.country, "Ethiopia");
    assert.equal(updated.active?.slice.sample.label, "Ethiopia Guji Lot 12");
    assert.equal(updated.rail[0]?.label, "Sample 01");
    assert.deepEqual(updated.rail[0]?.metadata, {});
    assert.equal(updated.rail[0]?.stages.find((stage) => stage.stageId === "mid_temp")?.status, "not_started");
    assert.equal(updated.sessionStatus, "active");

    const persisted = await repository.listSamples(session.sessionId);
    assert.equal(persisted[0]?.label, "Ethiopia Guji Lot 12");
    assert.equal(persisted[0]?.metadata.process, "Washed");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("score confirmation is the final sample mutation and locks the sample while allowing the session to finish", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-finish-gate-"));
  const db = NodeSQLiteDriver.open(join(dir, "finish.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-27T12:00:00+08:00";
    const session = createSession({ sessionId: "finish-session", now });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], now, () => "finish-sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);

    await screen.initialize(session.sessionId, now);
    for (const stageId of ["aroma", "high_temp", "mid_temp", "low_temp", "flavor", "overall"] as const) {
      await fillRequiredStage(screen, "finish-sample-1", stageId, "2026-08-27T12:03:00+08:00");
      await screen.completeStage("2026-08-27T12:04:00+08:00");
    }

    assert.equal(screen.canFinishSession(), false);
    await fillRequiredStage(screen, "finish-sample-1", "scoring", "2026-08-27T12:04:30+08:00");
    assert.deepEqual(screen.current()?.lockedSampleIds, ["finish-sample-1"]);
    await assert.rejects(
      () => screen.saveField("score_confirmed", false, "2026-08-27T12:04:31+08:00"),
      /SAMPLE_SCORE_LOCKED/
    );
    await assert.rejects(
      () => screen.saveSampleIdentity("finish-sample-1", "changed", {}, "2026-08-27T12:04:32+08:00"),
      /SAMPLE_SCORE_LOCKED/
    );
    await screen.completeStage("2026-08-27T12:04:45+08:00");
    assert.equal(screen.canFinishSession(), true);

    const completed = await screen.finishSession("2026-08-27T12:05:00+08:00");
    assert.equal(completed.sessionStatus, "completed");
    assert.equal(completed.sessionStartedAt, now);
    assert.equal(completed.sessionCompletedAt, "2026-08-27T12:05:00+08:00");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
