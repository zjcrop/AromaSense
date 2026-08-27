import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CuppingSessionController } from "../app/core/cupping-session-controller";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession } from "../app/core/session-lifecycle";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { StageProgressReader } from "../app/storage/stage-progress-reader";
import { CuppingScreenController } from "../app/ui/cupping-screen-controller";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");
const metadataMigration = readFileSync("app/storage/0002_session_metadata.sql", "utf8");

test("next completes current stage before opening next stage without voice side effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-screen-"));
  const db = NodeSQLiteDriver.open(join(dir, "screen.sqlite"));
  db.exec(schema);
  db.exec(metadataMigration);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-24T20:40:00+08:00";
    const session = createSession({ sessionId: "screen-session", now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "A" }],
      now,
      () => "sample-1"
    );
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(
      repository,
      (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`
    );
    const screen = new CuppingScreenController(
      repository,
      new StageProgressReader(db),
      editor
    );

    await screen.initialize(session.sessionId);
    await screen.select("sample-1", "preparation", now);
    const afterNext = await screen.goNext("2026-08-24T20:41:00+08:00");

    assert.equal(afterNext.active?.context.stageId, "aroma");
    const preparation = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "preparation");
    const aroma = afterNext.rail[0]?.stages.find((stage) => stage.stageId === "aroma");
    assert.equal(preparation?.status, "completed");
    assert.equal(aroma?.status, "active");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blind identity edits persist during any active stage while rail identity remains hidden", async () => {
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
      metadata: {
        date: "2026-08-27",
        time: "11:20",
        organizer: "tester",
        cuppingMode: "blind"
      }
    });
    const samples = buildSampleBatch(session.sessionId, [{}], now, () => "blind-sample-1");
    await repository.createSessionWithSamples(session, samples);

    const editor = new CuppingSessionController(
      repository,
      (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`
    );
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

    const persisted = await repository.listSamples(session.sessionId);
    assert.equal(persisted[0]?.label, "Ethiopia Guji Lot 12");
    assert.equal(persisted[0]?.metadata.process, "Washed");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
