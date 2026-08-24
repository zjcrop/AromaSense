import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession } from "../app/core/session-lifecycle";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { StageProgressReader } from "../app/storage/stage-progress-reader";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

test("100-sample session keeps rail lightweight while observations remain slice-scoped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-stress-"));
  const db = NodeSQLiteDriver.open(join(dir, "stress.sqlite"));
  db.exec(schema);
  try {
    const repository = new LocalCuppingRepository(db);
    const now = "2026-08-24T22:10:00+08:00";
    const session = createSession({ sessionId: "stress-session", now });
    const inputs = Array.from({ length: 100 }, (_, index) => ({ label: `Sample ${index + 1}` }));
    const samples = buildSampleBatch(session.sessionId, inputs, now, (index) => `sample-${index + 1}`);
    await repository.createSessionWithSamples(session, samples);

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      await repository.setStageState(session.sessionId, sample.sampleId, "high_temp", index % 2 === 0 ? "completed" : "active", now, now, index % 2 === 0 ? now : undefined);
      await repository.saveObservation({
        observationId: `${sample.sampleId}:high_temp:acidity_intensity`,
        sessionId: session.sessionId,
        sampleId: sample.sampleId,
        stageId: "high_temp",
        fieldKey: "acidity_intensity",
        value: (index % 15) + 0.5,
        dictionaryVersion: "sensory-dictionary/1.1",
        updatedAt: now
      });
    }

    const listed = await repository.listSamples(session.sessionId);
    const progress = await new StageProgressReader(db).listForSession(session.sessionId);
    assert.equal(listed.length, 100);
    assert.equal(progress.length, 100);

    const slice = await repository.loadEditingSlice(session.sessionId, "sample-50", "high_temp");
    assert.equal(slice.observations.length, 1);
    assert.equal(slice.observations[0]?.sampleId, "sample-50");

    const observationCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM observations WHERE session_id = ?", [session.sessionId]
    );
    assert.equal(observationCount?.count, 100);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
