import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventCacheStore } from "../app/storage/event-cache-store";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

test("event cache is revision ordered, idempotent and conflict safe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-event-"));
  const db = NodeSQLiteDriver.open(join(dir, "event.sqlite"));
  db.exec(readFileSync("app/storage/0001_local_schema.sql", "utf8"));
  db.exec(readFileSync("app/storage/0003_workflow_event_comparison.sql", "utf8"));
  const store = new EventCacheStore(db);
  const manifest = { schemaVersion: "aromasense-event-manifest/1.0" as const, eventId: "e1", eventRevision: 1, date: "2026-09-04", time: "20:00", organizer: "Lab", sampleCount: 2, interfaces: { invite: "a", qr: "q", deepLink: "d" } };
  try {
    assert.equal((await store.put(manifest, "now")).status, "created");
    assert.equal((await store.put(manifest, "later")).status, "already_present");
    await assert.rejects(() => store.put({ ...manifest, organizer: "Other" }, "later"), /EVENT_REVISION_CONFLICT/);
    assert.equal((await store.put({ ...manifest, eventRevision: 2, organizer: "Other" }, "later")).status, "updated");
    assert.equal((await store.get("e1"))?.eventRevision, 2);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
