import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalMigrationRunner } from "../app/storage/local-migration-runner";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-migration-"));
  const db = NodeSQLiteDriver.open(join(dir, "migration.sqlite"));
  return { dir, db };
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
