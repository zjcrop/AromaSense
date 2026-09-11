import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { SessionRecordsReader } from "../app/storage/session-records-reader";

test("record summaries use whole-record cloud acknowledgements for sync lights", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-record-summary-"));
  const db = NodeSQLiteDriver.open(join(dir, "records.sqlite"));
  try {
    db.exec(readFileSync("app/storage/0001_local_schema.sql", "utf8"));
    db.exec(readFileSync("app/storage/0002_session_metadata.sql", "utf8"));
    db.exec(readFileSync("app/storage/0008_record_sync.sql", "utf8"));
    db.exec(readFileSync("app/storage/0009_record_sync_status.sql", "utf8"));
    const metadata = JSON.stringify({ date: "2026-09-04", time: "10:00", organizer: "tester" });
    const baseTime = "2026-09-04T10:00:00.000Z";
    const changedTime = "2026-09-04T10:01:00.000Z";
    for (const sessionId of ["modern", "legacy", "unfinished"]) {
      await db.run(
        "INSERT INTO sessions (session_id,status,taxonomy_version,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?)",
        [sessionId, sessionId === "unfinished" ? "active" : "completed", sessionId === "legacy" ? "sensory-stage/1.0" : "sensory-flow/2.0", baseTime, baseTime, metadata]
      );
      await db.run(
        "INSERT INTO samples (sample_id,session_id,display_number,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        [`${sessionId}-sample`, sessionId, 1, 0, baseTime, baseTime]
      );
    }

    await db.run(
      "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["modern", "modern-sample", "aroma", "not_started", null, null, changedTime]
    );
    await db.run(
      "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["modern", "modern-sample", "scoring", "completed", changedTime, changedTime, changedTime]
    );
    await db.run(
      "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["legacy", "legacy-sample", "final", "completed", changedTime, changedTime, changedTime]
    );
    await db.run(
      "INSERT INTO stage_state (session_id,sample_id,stage_id,status,started_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ["unfinished", "unfinished-sample", "scoring", "active", changedTime, null, changedTime]
    );

    await db.run(
      "INSERT INTO record_sync_state (record_id,last_pushed_at,deleted_at,updated_at) VALUES (?,?,NULL,?)",
      ["modern", "2026-09-04T10:02:00.000Z", "2026-09-04T10:02:00.000Z"]
    );
    await db.run(
      "INSERT INTO record_sync_failures (record_id,error_message,failed_at) VALUES (?,?,?)",
      ["legacy", "RECORD_SYNC_HTTP_503", "2026-09-04T10:02:00.000Z"]
    );

    let records = await new SessionRecordsReader(db).list();
    assert.equal(records.find((item) => item.sessionId === "modern")?.completedSamples, 1);
    assert.equal(records.find((item) => item.sessionId === "modern")?.completionPct, 100);
    assert.equal(records.find((item) => item.sessionId === "legacy")?.completedSamples, 1);
    assert.equal(records.find((item) => item.sessionId === "unfinished")?.completedSamples, 0);
    assert.equal(records.find((item) => item.sessionId === "modern")?.syncState, "synced");
    assert.equal(records.find((item) => item.sessionId === "legacy")?.syncState, "failed");
    assert.equal(records.find((item) => item.sessionId === "unfinished")?.syncState, "pending");
    assert.equal(records.find((item) => item.sessionId === "legacy")?.syncError, "RECORD_SYNC_HTTP_503");

    await db.run("UPDATE samples SET updated_at = ? WHERE sample_id = ?", ["2026-09-04T10:03:00.000Z", "modern-sample"]);
    records = await new SessionRecordsReader(db).list();
    assert.equal(records.find((item) => item.sessionId === "modern")?.syncState, "pending", "new local edits must turn a green record blue until cloud confirms them");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
