import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
