import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

test("0.1C preparation/final rows migrate non-destructively into sensory-flow/2.0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-workflow-migration-"));
  const db = NodeSQLiteDriver.open(join(dir, "legacy.sqlite"));
  try {
    db.exec(readFileSync("app/storage/0001_local_schema.sql", "utf8"));
    await db.run("INSERT INTO sessions (session_id,status,taxonomy_version,created_at,updated_at) VALUES (?,?,?,?,?)", ["legacy", "active", "sensory-stage/1.0", "now", "now"]);
    await db.run("INSERT INTO samples (sample_id,session_id,display_number,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)", ["sample", "legacy", 1, 0, "now", "now"]);
    await db.run("INSERT INTO observations (observation_id,session_id,sample_id,stage_id,field_key,value_json,dictionary_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", ["prep-note", "legacy", "sample", "preparation", "notes", '\"dry jasmine\"', "legacy", "now", "now"]);
    await db.run("INSERT INTO observations (observation_id,session_id,sample_id,stage_id,field_key,value_json,dictionary_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", ["final-flavor", "legacy", "sample", "final", "flavor_tags", '[\"jasmine\"]', "legacy", "now", "now"]);
    await db.run("INSERT INTO observations (observation_id,session_id,sample_id,stage_id,field_key,value_json,dictionary_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", ["final-quality", "legacy", "sample", "final", "quality_balance", "8", "legacy", "now", "now"]);
    await db.run("INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)", ["legacy", "sample", "final", "completed", "now", "now", "now"]);

    const migration = readFileSync("app/storage/0003_workflow_event_comparison.sql", "utf8");
    db.exec(migration);
    db.exec(migration);
    const rows = await db.all<{ stage_id: string; field_key: string }>("SELECT stage_id, field_key FROM observations WHERE sample_id = ? ORDER BY stage_id, field_key", ["sample"]);
    assert.deepEqual(rows.map((row) => `${row.stage_id}:${row.field_key}`), [
      "aroma:notes", "final:flavor_tags", "final:quality_balance", "flavor:flavor_tags", "overall:quality_balance", "preparation:notes"
    ]);
    const steps = await db.all<{ stage_id: string }>("SELECT stage_id FROM stage_state WHERE sample_id = ? ORDER BY stage_id", ["sample"]);
    assert.deepEqual(steps.map((row) => row.stage_id), ["final", "flavor", "overall", "scoring"]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
