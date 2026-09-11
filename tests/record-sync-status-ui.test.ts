import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("records UI exposes green synced, blue pending, red failed lights and upload-all action", () => {
  const renderer = readFileSync("app/ui/dom/session-records-renderer.ts", "utf8");
  const reader = readFileSync("app/storage/session-records-reader.ts", "utf8");
  const migration = readFileSync("app/storage/0009_record_sync_status.sql", "utf8");

  assert.match(renderer, /is-synced\{background:#55c878/);
  assert.match(renderer, /is-pending\{background:#58a9e8/);
  assert.match(renderer, /is-failed\{background:#e05b5b/);
  assert.match(renderer, /上传云端/);
  assert.match(renderer, /syncAll\(\)/);
  assert.match(reader, /record_sync_state/);
  assert.match(reader, /record_sync_failures/);
  assert.match(reader, /last_pushed_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS record_sync_failures/);
});
