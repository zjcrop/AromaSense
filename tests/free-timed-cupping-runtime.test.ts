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
  const editor = new CuppingSessionController(
    repository,
    (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`
  );
  return new CuppingScreenController(repository, new StageProgressReader(db), editor);
}

test("free cupping can pause, add, edit and delete samples without fabricating a new session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-free-cupping-"));
  const db = NodeSQLiteDriver.open(join(dir, "free.sqlite"));
  applySchema(db);
  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-09-06T20:00:00+08:00";
    const session = createSession({
      sessionId: "free-session",
      now,
      metadata: { date: "2026-09-06", time: "20:00", organizer: "tester", cuppingMode: "free" }
    });
    const initial = buildSampleBatch(session.sessionId, [{ label: "A" }], now, () => "free-sample-1");
    await repository.createSessionWithSamples(session, initial);
    const screen = buildScreen(db, repository);

    await screen.initialize(session.sessionId, now);
    await screen.select("free-sample-1", "aroma", now);
    assert.ok(screen.current()?.active);
    await screen.pauseEditing();
    assert.equal(screen.current()?.active, undefined);

    const afterAdd = await screen.addSample("free-sample-2", { metadata: {} }, "2026-09-06T20:01:00+08:00");
    assert.equal(afterAdd.samples.length, 2);
    assert.equal(afterAdd.samples[1]?.displayNumber, 2);
    assert.equal(afterAdd.samples[1]?.sortOrder, 2);

    const afterIdentity = await screen.saveSampleIdentity(
      "free-sample-2",
      "Kenya AA",
      { country: "Kenya", process: "Washed" },
      "2026-09-06T20:02:00+08:00"
    );
    assert.equal(afterIdentity.samples[1]?.label, "Kenya AA");
    assert.equal(afterIdentity.samples[1]?.metadata.country, "Kenya");

    const afterDelete = await screen.deleteSample("free-sample-1", "2026-09-06T20:03:00+08:00");
    assert.equal(afterDelete.samples.length, 1);
    assert.equal(afterDelete.samples[0]?.sampleId, "free-sample-2");
    assert.equal(afterDelete.samples[0]?.displayNumber, 1);
    assert.equal(afterDelete.samples[0]?.sortOrder, 1);
    assert.equal(afterDelete.sessionId, session.sessionId);
    assert.equal((await repository.listSamples(session.sessionId))[0]?.label, "Kenya AA");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("competition roster and identity are editable only during preflight and lock immediately after start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-competition-cupping-"));
  const db = NodeSQLiteDriver.open(join(dir, "competition.sqlite"));
  applySchema(db);
  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-09-06T20:10:00+08:00";
    const session = createSession({
      sessionId: "competition-session",
      now,
      metadata: { date: "2026-09-06", time: "20:10", organizer: "tester", cuppingMode: "competition" }
    });
    const initial = buildSampleBatch(session.sessionId, [{ label: "A" }, { label: "B" }], now, (index) => `competition-sample-${index + 1}`);
    await repository.createSessionWithSamples(session, initial);
    const screen = buildScreen(db, repository);
    await screen.initialize(session.sessionId, now);

    await screen.saveSampleIdentity("competition-sample-1", "A-preflight", { country: "Ethiopia" }, "2026-09-06T20:10:10+08:00");
    await screen.reorderSampleIds(["competition-sample-2", "competition-sample-1"], "2026-09-06T20:10:20+08:00");
    await screen.addSample("competition-sample-3", { label: "C", metadata: {} }, "2026-09-06T20:10:30+08:00");
    await screen.deleteSample("competition-sample-3", "2026-09-06T20:10:40+08:00");
    assert.equal(screen.current()?.samples.length, 2);

    await screen.startCompetition("2026-09-06T20:11:00+08:00");
    await assert.rejects(
      () => screen.addSample("competition-sample-3", { metadata: {} }, "2026-09-06T20:11:01+08:00"),
      /CUPPING_ROSTER_LOCKED/
    );
    await assert.rejects(
      () => screen.deleteSample("competition-sample-1", "2026-09-06T20:11:02+08:00"),
      /CUPPING_ROSTER_LOCKED/
    );
    await assert.rejects(
      () => screen.reorderSampleIds(["competition-sample-1", "competition-sample-2"], "2026-09-06T20:11:03+08:00"),
      /CUPPING_ROSTER_LOCKED/
    );
    await assert.rejects(
      () => screen.saveSampleIdentity("competition-sample-1", "changed", {}, "2026-09-06T20:11:04+08:00"),
      /CUPPING_SAMPLE_IDENTITY_LOCKED/
    );
    await screen.pauseEditing();
    assert.equal((await repository.listSamples(session.sessionId)).length, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
