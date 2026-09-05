import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalMigrationRunner } from "../app/storage/local-migration-runner";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-migration-"));
  const filename = join(dir, "migration.sqlite");
  const db = NodeSQLiteDriver.open(filename);
  return { dir, filename, db };
}

function migrationSql(filename: string): string {
  return readFileSync(join(process.cwd(), "app", "storage", filename), "utf8");
}

test("local migration applies once and remains restart-safe", async () => {
  const f = fixture();
  try {
    const migration = {
      id: 1,
      name: "test",
      sql: "CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL);"
    };
    const runner = new LocalMigrationRunner(f.db);
    await runner.apply([migration], "2026-08-24T21:50:00+08:00");
    await f.db.run("INSERT INTO sample (id, value) VALUES (?, ?)", ["a", "kept"]);
    await runner.apply([migration], "2026-08-24T21:51:00+08:00");
    const row = await f.db.get<{ value: string }>("SELECT value FROM sample WHERE id = ?", ["a"]);
    assert.equal(row?.value, "kept");
    const count = await f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM _aromasense_migrations");
    assert.equal(count?.count, 1);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("forward migration after database reopen preserves existing rows", async () => {
  const f = fixture();
  const first = {
    id: 1,
    name: "base",
    sql: "CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL);"
  };
  const second = {
    id: 2,
    name: "add_note",
    sql: "ALTER TABLE sample ADD COLUMN note TEXT; CREATE INDEX idx_sample_value ON sample(value);"
  };

  try {
    await new LocalMigrationRunner(f.db).apply([first], "2026-08-24T21:52:00+08:00");
    await f.db.run("INSERT INTO sample (id, value) VALUES (?, ?)", ["legacy", "preserved"]);
    f.db.close();

    const reopened = NodeSQLiteDriver.open(f.filename);
    try {
      await new LocalMigrationRunner(reopened).apply([first, second], "2026-08-24T21:53:00+08:00");
      const legacy = await reopened.get<{ value: string; note: string | null }>(
        "SELECT value, note FROM sample WHERE id = ?", ["legacy"]
      );
      assert.deepEqual(legacy, { value: "preserved", note: null });
      await reopened.run("UPDATE sample SET note = ? WHERE id = ?", ["new-schema", "legacy"]);
      assert.equal((await reopened.get<{ note: string }>("SELECT note FROM sample WHERE id = ?", ["legacy"]))?.note, "new-schema");
      assert.equal((await reopened.get<{ count: number }>("SELECT COUNT(*) AS count FROM _aromasense_migrations"))?.count, 2);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("workflow migration skips orphan legacy children without deleting them", async () => {
  const f = fixture();
  const base = {
    id: 1,
    name: "local_schema_v1",
    sql: migrationSql("0001_local_schema.sql")
  };
  const workflow = {
    id: 3,
    name: "workflow_event_comparison_0_2",
    sql: migrationSql("0003_workflow_event_comparison.sql")
  };
  const now = "2026-09-05T10:15:00Z";

  try {
    await new LocalMigrationRunner(f.db).apply([base], now);
    await f.db.run(
      "INSERT INTO sessions (session_id, title, status, taxonomy_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["session-valid", "legacy", "active", "sensory-dictionary/1.0", now, now]
    );
    await f.db.run(
      "INSERT INTO samples (sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["sample-valid", "session-valid", 1, 1, "1", "{}", now, now]
    );
    await f.db.run(
      "INSERT INTO observations (observation_id, session_id, sample_id, stage_id, field_key, value_json, dictionary_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["obs-valid", "session-valid", "sample-valid", "preparation", "dry_fragrance_intensity", "7", "sensory-dictionary/1.0", now, now]
    );
    await f.db.run(
      "INSERT INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["session-valid", "sample-valid", "preparation", "active", now, null, now]
    );

    // Simulate a historical browser database written while FK enforcement was disabled.
    f.db.exec("PRAGMA foreign_keys = OFF");
    await f.db.run(
      "INSERT INTO observations (observation_id, session_id, sample_id, stage_id, field_key, value_json, dictionary_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["obs-orphan", "session-missing", "sample-missing", "preparation", "dry_fragrance_intensity", "6", "sensory-dictionary/1.0", now, now]
    );
    await f.db.run(
      "INSERT INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["session-missing", "sample-missing", "preparation", "active", now, null, now]
    );
    f.db.exec("PRAGMA foreign_keys = ON");

    await new LocalMigrationRunner(f.db).apply([base, workflow], now);

    assert.equal(
      (await f.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observations WHERE observation_id = 'obs-valid:flow-aroma'"
      ))?.count,
      1
    );
    assert.equal(
      (await f.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM stage_state WHERE session_id = 'session-valid' AND sample_id = 'sample-valid' AND stage_id = 'aroma'"
      ))?.count,
      1
    );
    assert.equal(
      (await f.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observations WHERE observation_id = 'obs-orphan'"
      ))?.count,
      1,
      "legacy orphan source row must be preserved"
    );
    assert.equal(
      (await f.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM observations WHERE observation_id = 'obs-orphan:flow-aroma'"
      ))?.count,
      0,
      "migration must not create a new orphan row"
    );
    assert.equal(
      (await f.db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM stage_state WHERE session_id = 'session-missing' AND sample_id = 'sample-missing' AND stage_id = 'aroma'"
      ))?.count,
      0
    );
    assert.equal(
      (await f.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM _aromasense_migrations"))?.count,
      2
    );
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
