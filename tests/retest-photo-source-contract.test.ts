import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("image and split recognition ask for camera or existing image", () => {
  const importDialog = readFileSync("app/ui/dom/import-source-dialog.ts", "utf8");
  const split = readFileSync("app/ui/dom/manual-split-photo-mode.ts", "utf8");
  assert.match(importDialog, /选择图片来源/);
  assert.match(importDialog, /拍照/);
  assert.match(importDialog, /上传图片/);
  assert.match(importDialog, /hasAttribute\("capture"\)/);
  assert.match(split, /openManualSplitSourceChoice/);
  assert.match(split, /data-camera/);
  assert.match(split, /data-upload/);
});

test("completed records support single and batch retest while preserving bean roster", () => {
  const records = readFileSync("app/ui/dom/session-records-renderer.ts", "utf8");
  const repository = readFileSync("app/storage/local-cupping-repository.ts", "utf8");
  const service = readFileSync("app/core/session-record-service.ts", "utf8");
  const app = readFileSync("app/runtime/dom-app.ts", "utf8");
  assert.match(records, /onRetest/);
  assert.match(records, /批量复测/);
  assert.match(records, /completedEditableAt/);
  assert.match(repository, /resetSessionForRetest/);
  assert.match(repository, /DELETE FROM observations WHERE session_id = \?/);
  assert.match(repository, /DELETE FROM stage_state WHERE session_id = \?/);
  const resetBody = repository.slice(repository.indexOf("resetSessionForRetest"));
  assert.doesNotMatch(resetBody, /DELETE FROM samples/);
  assert.match(repository, /status: "draft" as const/);
  assert.match(service, /async retest/);
  assert.match(app, /recordService\.retest/);
});
