import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSession } from "../app/core/session-lifecycle";
import { buildSampleBatch, reorderSamples } from "../app/core/sample-batch-service";
import { CuppingSessionController } from "../app/core/cupping-session-controller";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-"));
  const filename = join(dir, "session.sqlite");
  const db = NodeSQLiteDriver.open(filename);
  db.exec(schema);
  const repository = new LocalCuppingRepository(db);
  return { dir, filename, db, repository };
}

test("session+sample creation is atomic and editable slices survive restart", async () => {
  const f = fixture();
  try {
    const now = "2026-08-24T20:00:00+08:00";
    const session = createSession({ sessionId: "session-1", title: "Test", now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "A" }, { label: "B" }],
      now,
      (index) => `sample-${index + 1}`
    );

    await f.repository.createSessionWithSamples(session, samples);
    const controller = new CuppingSessionController(
      f.repository,
      (context, fieldKey) => `${context.sampleId}:${context.stageId}:${fieldKey}`
    );

    await controller.open(
      { sessionId: session.sessionId, sampleId: "sample-1", stageId: "high_temp" },
      now
    );
    await controller.saveField("acidity_intensity", 7.5, "2026-08-24T20:01:00+08:00");
    await controller.saveField("sweetness_intensity", 8, "2026-08-24T20:01:01+08:00");
    await controller.flush();
    f.db.close();

    const reopened = NodeSQLiteDriver.open(f.filename);
    const recoveredRepository = new LocalCuppingRepository(reopened);
    const recovered = await recoveredRepository.loadEditingSlice(
      session.sessionId,
      "sample-1",
      "high_temp"
    );

    assert.equal(recovered.stageStatus, "active");
    assert.deepEqual(
      recovered.observations.map((item) => [item.fieldKey, item.value]),
      [
        ["acidity_intensity", 7.5],
        ["sweetness_intensity", 8]
      ]
    );
    reopened.close();
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("sample reorder persists without unique-index collisions", async () => {
  const f = fixture();
  try {
    const now = "2026-08-24T20:00:00+08:00";
    const session = createSession({ sessionId: "session-2", now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "A" }, { label: "B" }, { label: "C" }],
      now,
      (index) => `sample-${index + 1}`
    );
    await f.repository.createSessionWithSamples(session, samples);

    const reordered = reorderSamples(
      samples,
      ["sample-3", "sample-1", "sample-2"],
      "2026-08-24T20:02:00+08:00"
    );
    await f.repository.replaceSampleOrder(session.sessionId, reordered);

    const stored = await f.repository.listSamples(session.sessionId);
    assert.deepEqual(stored.map((sample) => sample.sampleId), ["sample-3", "sample-1", "sample-2"]);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("failed transaction rolls back all writes", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.db.transaction(async () => {
        await f.db.run(
          "INSERT INTO sessions (session_id,status,taxonomy_version,created_at,updated_at) VALUES (?,?,?,?,?)",
          ["rollback-me", "draft", "sensory-stage/1.0", "now", "now"]
        );
        throw new Error("forced failure");
      }),
      /forced failure/
    );

    const row = await f.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?",
      ["rollback-me"]
    );
    assert.equal(row?.count, 0);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
