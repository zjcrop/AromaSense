import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SessionRecordsReader } from "../app/storage/session-records-reader";
import { STAGE_IDS } from "../shared/protocol/aromasense-v1";

test("record summaries count complete seven-step samples and legacy final samples", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-record-summary-"));
  const db = NodeSQLiteDriver.open(join(dir, "records.sqlite"));
  try {
    db.exec(readFileSync("app/storage/0001_local_schema.sql", "utf8"));
    db.exec(readFileSync("app/storage/0002_session_metadata.sql", "utf8"));
    const metadata = JSON.stringify({ date: "2026-09-04", time: "10:00", organizer: "tester" });
    for (const sessionId of ["modern", "legacy"]) {
      await db.run(
        "INSERT INTO sessions (session_id,status,taxonomy_version,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?)",
        [sessionId, "completed", sessionId === "modern" ? "sensory-flow/2.0" : "sensory-stage/1.0", "2026-09-04T10:00:00Z", "2026-09-04T10:00:00Z", metadata]
      );
      await db.run(
        "INSERT INTO samples (sample_id,session_id,display_number,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        [`${sessionId}-sample`, sessionId, 1, 0, "2026-09-04T10:00:00Z", "2026-09-04T10:00:00Z"]
      );
    }

    for (const stageId of STAGE_IDS) {
      await db.run(
        "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        ["modern", "modern-sample", stageId, "completed", "now", "now", "now"]
      );
    }
    await db.run(
      "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["legacy", "legacy-sample", "final", "completed", "now", "now", "now"]
    );

    const records = await new SessionRecordsReader(db).list();
    assert.equal(records.find((item) => item.sessionId === "modern")?.completedSamples, 1);
    assert.equal(records.find((item) => item.sessionId === "modern")?.completionPct, 100);
    assert.equal(records.find((item) => item.sessionId === "legacy")?.completedSamples, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
