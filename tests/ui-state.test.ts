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
import { UserPreferencesRepository } from "../app/storage/user-preferences-repository";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";
import { FlavorGroupPreferenceService } from "../app/ui/flavor-group-preferences";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-ui-"));
  const filename = join(dir, "ui.sqlite");
  const db = NodeSQLiteDriver.open(filename);
  db.exec(schema);
  return { dir, db, repository: new LocalCuppingRepository(db) };
}

test("sample rail derives progress from persisted sensory edits rather than visited pages", async () => {
  const f = fixture();
  try {
    const now = "2026-08-24T20:30:00+08:00";
    const session = createSession({ sessionId: "ui-session", now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "A" }, { label: "B" }],
      now,
      (index) => `sample-${index + 1}`
    );
    await f.repository.createSessionWithSamples(session, samples);
    await f.repository.saveObservation({
      observationId: "prep-dry",
      sessionId: session.sessionId,
      sampleId: "sample-1",
      stageId: "preparation",
      fieldKey: "dry_fragrance_intensity",
      value: 6,
      dictionaryVersion: "sensory-dictionary/1.2",
      updatedAt: now
    });
    await f.repository.saveObservation({
      observationId: "high-acidity",
      sessionId: session.sessionId,
      sampleId: "sample-1",
      stageId: "high_temp",
      fieldKey: "acidity_intensity",
      value: 7,
      dictionaryVersion: "sensory-dictionary/1.2",
      updatedAt: now
    });

    const progress = await new StageProgressReader(f.db).listForSession(session.sessionId);
    const rail = buildSampleRailViewState(samples, progress, "sample-1");

    assert.equal(rail[0]?.active, true);
    assert.equal(rail[0]?.completedStageCount, 1);
    assert.equal(rail[0]?.startedStageCount, 2);
    assert.equal(rail[0]?.stages.find((stage) => stage.stageId === "high_temp")?.status, "active");
    assert.equal(rail[1]?.startedStageCount, 0);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("flavor groups and descriptors persist explicit order", async () => {
  const f = fixture();
  try {
    const service = new FlavorGroupPreferenceService(new UserPreferencesRepository(f.db));
    const defaults = await service.load();
    assert.equal(defaults.collapsedGroupIds.length, defaults.orderedGroupIds.length);

    const expanded = await service.setCollapsed("floral", false, "2026-08-24T20:31:00+08:00");
    assert.equal(expanded.collapsedGroupIds.includes("floral"), false);

    const reverseGroups = [...expanded.orderedGroupIds].reverse();
    await service.reorder(reverseGroups, "2026-08-24T20:32:00+08:00");

    const floral = [...(expanded.descriptorOrderByGroup.floral ?? [])].reverse();
    await service.reorderDescriptors("floral", floral, "2026-08-24T20:33:00+08:00");

    const recovered = await service.load();
    assert.deepEqual(recovered.orderedGroupIds, reverseGroups);
    assert.deepEqual(recovered.descriptorOrderByGroup.floral, floral);
    assert.equal(recovered.collapsedGroupIds.includes("floral"), false);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
