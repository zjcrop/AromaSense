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
const timingMigration = readFileSync("app/storage/0005_session_timing.sql", "utf8");

function applySchema(db: NodeSQLiteDriver): void {
  db.exec(schema);
  db.exec(metadataMigration);
  db.exec(timingMigration);
}

function buildScreen(db: NodeSQLiteDriver, repository: LocalCuppingRepository): CuppingScreenController {
  const editor = new CuppingSessionController(repository, (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`);
  return new CuppingScreenController(repository, new StageProgressReader(db), editor);
}

test("normal cupping browsing does not start the wall clock and the first sensory write establishes a stable start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-screen-"));
  const db = NodeSQLiteDriver.open(join(dir, "screen.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const createdAt = "2026-08-24T20:39:00+08:00";
    const enteredAt = "2026-08-24T20:40:00+08:00";
    const firstWriteAt = "2026-08-24T20:40:20+08:00";
    const session = createSession({ sessionId: "screen-session", now: createdAt, metadata: { cuppingMode: "formal" } });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }], createdAt, () => "sample-1");
    await repository.createSessionWithSamples(session, samples);
    const screen = buildScreen(db, repository);

    await screen.initialize(session.sessionId, enteredAt);
    assert.equal(screen.current()?.sessionStatus, "draft");
    assert.equal(screen.current()?.sessionStartedAt, undefined);

    for (const stage of ["aroma", "high_temp", "mid_temp", "low_temp", "flavor", "overall", "scoring"] as const) {
      await screen.select("sample-1", stage, enteredAt);
      assert.equal(screen.current()?.sessionStatus, "draft");
      assert.equal((await repository.getSession(session.sessionId)).startedAt, undefined);
      assert.equal(screen.current()?.rail[0]?.stages.find((item) => item.stageId === stage)?.status, "not_started");
    }

    await screen.select("sample-1", "aroma", enteredAt);
    await screen.saveField("notes", "花香逐渐展开", firstWriteAt);
    assert.equal(screen.current()?.sessionStatus, "active");
    assert.equal(screen.current()?.sessionStartedAt, firstWriteAt);
    assert.equal((await repository.getSession(session.sessionId)).startedAt, firstWriteAt);

    await screen.leaveSession();
    await screen.initialize(session.sessionId, "2026-08-24T20:41:00+08:00");
    assert.equal(screen.current()?.sessionStartedAt, firstWriteAt, "re-entry must not reset the persisted wall-clock anchor");
    await screen.select("sample-1", "aroma", "2026-08-24T20:41:00+08:00");
    assert.equal(screen.current()?.active?.slice.observations.find((item) => item.fieldKey === "notes")?.value, "花香逐渐展开");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blind identity can be prepared before competition start while the participant rail remains hidden", async () => {
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
    const screen = buildScreen(db, repository);

    await screen.initialize(session.sessionId, now);
    const updated = await screen.saveSampleIdentity(
      "blind-sample-1",
      "Ethiopia Guji Lot 12",
      { country: "Ethiopia", region: "Guji", process: "Washed", roast: "Light" },
      "2026-08-27T11:20:30+08:00"
    );
    assert.equal(updated.samples[0]?.label, "Ethiopia Guji Lot 12");
    assert.equal(updated.rail[0]?.label, "Sample 01");
    assert.deepEqual(updated.rail[0]?.metadata, {});

    await assert.rejects(() => screen.select("blind-sample-1", "mid_temp", now), /COMPETITION_NOT_STARTED/);
    await screen.startCompetition("2026-08-27T11:21:00+08:00");
    const active = await screen.select("blind-sample-1", "mid_temp", "2026-08-27T11:21:01+08:00");
    assert.equal(active.active?.context.stageId, "mid_temp");
    assert.equal(active.rail[0]?.label, "Sample 01");
    assert.deepEqual(active.rail[0]?.metadata, {});
    await assert.rejects(
      () => screen.saveSampleIdentity("blind-sample-1", "changed", {}, "2026-08-27T11:21:02+08:00"),
      /CUPPING_SAMPLE_IDENTITY_LOCKED/
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("competition keeps samples editable during scoring and locks all of them only at final session completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-competition-lock-"));
  const db = NodeSQLiteDriver.open(join(dir, "competition.sqlite"));
  applySchema(db);

  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-27T12:00:00+08:00";
    const session = createSession({
      sessionId: "competition-session",
      now,
      metadata: { date: "2026-08-27", time: "12:00", organizer: "tester", cuppingMode: "competition" }
    });
    const samples = buildSampleBatch(session.sessionId, [{ label: "A" }, { label: "B" }], now, (index) => `competition-sample-${index + 1}`);
    await repository.createSessionWithSamples(session, samples);
    const screen = buildScreen(db, repository);

    await screen.initialize(session.sessionId, now);
    await screen.startCompetition("2026-08-27T12:00:05+08:00");
    await screen.select("competition-sample-1", "scoring", "2026-08-27T12:05:00+08:00");
    assert.deepEqual(screen.current()?.lockedSampleIds, []);
    assert.equal(screen.canFinishSession(), true);

    const completed = await screen.finishSession("2026-08-27T12:30:05+08:00");
    assert.equal(completed.sessionStatus, "completed");
    assert.equal(completed.sessionStartedAt, "2026-08-27T12:00:05+08:00");
    assert.equal(completed.sessionCompletedAt, "2026-08-27T12:30:05+08:00");
    assert.deepEqual(completed.lockedSampleIds, ["competition-sample-1", "competition-sample-2"]);
    await assert.rejects(
      () => screen.select("competition-sample-1", "aroma", "2026-08-27T12:30:06+08:00"),
      /COMPLETED_SESSION_IS_READ_ONLY/
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
