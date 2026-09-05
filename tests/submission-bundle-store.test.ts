import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { createSession } from "../app/core/session-lifecycle";
import { SessionRecordService } from "../app/core/session-record-service";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { LocalMigrationRunner } from "../app/storage/local-migration-runner";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SubmissionBundleStore } from "../app/storage/submission-bundle-store";

test("submission revisions survive forward migration and restart, are idempotent and independent of event revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-submission-"));
  const filename = join(dir, "submission.sqlite");
  let db = NodeSQLiteDriver.open(filename);
  const now = "2026-09-05T03:00:00Z";
  const migrations = ["0001_local_schema", "0002_session_metadata", "0003_workflow_event_comparison", "0004_submission_revisions"].map((name, i) => ({ id: i + 1, name, sql: readFileSync(`app/storage/${name}.sql`, "utf8") }));
  try {
    await new LocalMigrationRunner(db).apply(migrations.slice(0, 2), now);
    const repository = new LocalCuppingRepository(db);
    const session = createSession({ sessionId: "s", now, metadata: { date: "2026-09-05", time: "03:00", organizer: "Lab", eventId: "event", eventRevision: 9 } });
    await repository.createSessionWithSamples(session, buildSampleBatch("s", [{ label: "Preserved" }], now, () => "sample"));
    await new LocalMigrationRunner(db).apply(migrations, now);
    const snapshot = await new SessionRecordService(repository, () => now).snapshot("s");
    assert.equal(snapshot.samples[0].label, "Preserved");
    const store = new SubmissionBundleStore(db);
    const [first, duplicate] = await Promise.all([store.create(snapshot), store.create({ ...snapshot, exportedAt: "later" })]);
    assert.equal(first.revision, 1);
    assert.equal(duplicate.revision, 1);
    assert.equal(first.contentHash, duplicate.contentHash);
    assert.equal(first.eventManifest.eventRevision, 9);
    db.close();
    db = NodeSQLiteDriver.open(filename);
    await new LocalMigrationRunner(db).apply(migrations, now);
    const reopened = new SubmissionBundleStore(db);
    assert.equal((await reopened.create(snapshot)).revision, 1);
    const changed = { ...snapshot, observations: [{ observationId: "o", sessionId: "s", sampleId: "sample", stageId: "aroma" as const, fieldKey: "notes", value: "jasmine", dictionaryVersion: "test", updatedAt: now }] };
    const second = await reopened.create(changed);
    assert.equal(second.revision, 2);
    assert.notEqual(second.contentHash, first.contentHash);
    assert.equal(second.eventManifest.eventRevision, 9);
    assert.equal((await reopened.create(snapshot)).revision, 3);
    await assert.rejects(() => db.run("INSERT INTO submission_revisions VALUES (?, ?, ?, ?)", ["s", 1, second.contentHash, now]), /UNIQUE constraint/);
    assert.equal((await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM submission_revisions"))?.count, 3);
    assert.equal((await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM _aromasense_migrations"))?.count, 4);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
