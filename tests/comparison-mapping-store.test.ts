import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ComparisonMappingStore } from "../app/storage/comparison-mapping-store";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

test("comparison store persists exactly one peer per local session and can clear it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-comparison-store-"));
  const db = NodeSQLiteDriver.open(join(dir, "comparison.sqlite"));
  try {
    db.exec(readFileSync("app/storage/0001_local_schema.sql", "utf8"));
    db.exec(readFileSync("app/storage/0003_workflow_event_comparison.sql", "utf8"));
    await db.run("INSERT INTO sessions (session_id,status,taxonomy_version,created_at,updated_at) VALUES (?,?,?,?,?)", ["local", "completed", "sensory-flow/2.0", "now", "now"]);
    const store = new ComparisonMappingStore(db);
    const value = (subject: string) => ({
      bundle: { schemaVersion: "aromasense-comparison/1.0" as const, comparisonSubjectId: subject, eventId: "event", eventRevision: 1, mode: "open" as const, samples: [] },
      mapping: { schemaVersion: "aromasense-comparison-mapping/1.0" as const, localSessionId: "local", comparisonSubjectId: subject, createdAt: "now", entries: [] }
    });
    await store.replace("local", value("peer-1"), "one");
    await store.replace("local", value("peer-2"), "two");
    assert.equal((await store.get("local"))?.bundle.comparisonSubjectId, "peer-2");
    const count = await db.get<{ count: number }>("SELECT COUNT(*) AS count FROM comparison_mappings WHERE local_session_id = ?", ["local"]);
    assert.equal(count?.count, 1);
    await store.clear("local");
    assert.equal(await store.get("local"), undefined);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
