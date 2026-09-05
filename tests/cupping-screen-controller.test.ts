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

test("browsing does not start a step; real input does, and next requires completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-screen-"));
  const db = NodeSQLiteDriver.open(join(dir, "screen.sqlite"));
  db.exec(schema);
  db.exec(metadataMigration);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-24T20:40:00+08:00";
    const session = createSession({ sessionId: "screen-session", now });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], now, () => "sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);

    await screen.initialize(session.sessionId);
    await screen.select("sample-1", "aroma", now);
    assert.equal(screen.current()?.rail[0]?.stages.find((stage) => stage.stageId === "aroma")?.status, "not_started");
    await screen.saveField("wet_aroma_intensity", 7, "2026-08-24T20:40:30+08:00");
    assert.equal(screen.current()?.rail[0]?.stages.find((stage) => stage.stageId === "aroma")?.status, "active");
    await assert.rejects(() => screen.goNext("2026-08-24T20:40:40+08:00"), /STAGE_INCOMPLETE:aroma/);
    await screen.saveField("flavor_tags", ["jasmine"], "2026-08-24T20:40:50+08:00");
    const afterNext = await screen.goNext("2026-08-24T20:41:00+08:00");

    assert.equal(afterNext.active?.context.stageId, "high_temp");
    const aroma = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "aroma");
    const high = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "high_temp");
    assert.equal(aroma?.status, "completed");
    assert.equal(high?.status, "not_started");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blind identity edits persist during any browsed stage while rail identity remains hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-blind-identity-"));
  const db = NodeSQLiteDriver.open(join(dir, "blind.sqlite"));
  db.exec(schema);
  db.exec(metadataMigration);

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

    await screen.initialize(session.sessionId);
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

    const persisted = await repository.listSamples(session.sessionId);
    assert.equal(persisted[0]?.label, "Ethiopia Guji Lot 12");
    assert.equal(persisted[0]?.metadata.process, "Washed");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session finish requires all sensory criteria including explicit score confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-finish-gate-"));
  const db = NodeSQLiteDriver.open(join(dir, "finish.sqlite"));
  db.exec(schema);
  db.exec(metadataMigration);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-27T12:00:00+08:00";
    const session = createSession({ sessionId: "finish-session", now });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], now, () => "finish-sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
    const screen = new CuppingScreenController(repository, new StageProgressReader(db), editor);

    await screen.initialize(session.sessionId);
    await fillRequiredStage(screen, "finish-sample-1", "scoring", now);
    await screen.completeStage("2026-08-27T12:01:00+08:00");
    assert.equal(screen.canFinishSession(), false);
    await assert.rejects(() => screen.finishSession("2026-08-27T12:02:00+08:00"), /ALL_SAMPLE_STAGES_REQUIRED/);

    for (const stageId of ["aroma", "high_temp", "mid_temp", "low_temp", "flavor", "overall"] as const) {
      await fillRequiredStage(screen, "finish-sample-1", stageId, "2026-08-27T12:03:00+08:00");
      await screen.completeStage("2026-08-27T12:04:00+08:00");
    }

    assert.equal(screen.canFinishSession(), false);
    assert.equal(screen.current()?.rail[0]?.stages.find((stage) => stage.stageId === "scoring")?.status, "active");
    await fillRequiredStage(screen, "finish-sample-1", "scoring", "2026-08-27T12:04:30+08:00");
    await screen.completeStage("2026-08-27T12:04:45+08:00");
    assert.equal(screen.canFinishSession(), true);
    const completed = await screen.finishSession("2026-08-27T12:05:00+08:00");
    assert.equal(completed.sessionStatus, "completed");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
