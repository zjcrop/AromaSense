import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Yingxiang owner can cancel a running activity before explicitly deleting it", () => {
  const api = readFileSync("cloud/worker/src/yingxiang-management-api.ts", "utf8");
  const client = readFileSync("app/core/yingxiang-client.ts", "utf8");
  const consoleUi = readFileSync("app/ui/dom/yingxiang-console-renderer.ts", "utf8");

  assert.match(api, /dashboard\|republish\|cancel\|delete/);
  assert.match(api, /UPDATE yingxiang_events SET status='cancelled'/);
  assert.match(api, /UPDATE yingxiang_participants SET status='released'/);
  assert.match(api, /UPDATE yingxiang_invites SET revoked_at=/);
  assert.match(api, /YINGXIANG_EVENT_DELETE_REQUIRES_CANCEL/);
  assert.match(api, /DELETE FROM yingxiang_submissions/);
  assert.match(api, /DELETE FROM yingxiang_events/);
  assert.match(client, /async cancelEvent\(eventId: string\)/);
  assert.match(client, /async deleteEvent\(eventId: string\)/);
  assert.match(consoleUi, /"取消活动"/);
  assert.match(consoleUi, /"删除活动"/);
  assert.match(consoleUi, /彻底删除本活动及邀请、参与身份和回传结果/);
});

test("Yingxiang photo numbering always exposes progress and restores controls after OCR failure", () => {
  const source = readFileSync("app/ui/dom/yingxiang-sample-code-importer.ts", "utf8");
  assert.match(source, /yx-sample-import__progress/);
  assert.match(source, /PP-OCRv5 正在识别编号/);
  assert.match(source, /recognizer\.recognizeBatch/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /finally \{\s*window\.clearInterval\(timer\); this\.setDisabled\(false\);\s*\}/s);
  assert.match(source, /cameraInput\.value = ""/);
});

test("Yingxiang recognized coffee candidates use one compact size and long-press whole-card reordering", () => {
  const source = readFileSync("app/ui/dom/yingxiang-coffee-list-editor.ts", "utf8");
  assert.match(source, /const LONG_PRESS_MS = 460/);
  assert.match(source, /width:40px;height:40px;min-width:40px;max-width:40px/);
  assert.match(source, /font-size:11px/);
  assert.match(source, /font-size:9\.5px/);
  assert.match(source, /setTimeout\(\(\)=>\{if\(!moved\)\{this\.enterOrderEditing\(\);\}\},LONG_PRESS_MS\)/);
  assert.match(source, /card\.dataset\.orderDrag="true"/);
  assert.match(source, /attachDragReorder\(this\.list/);
  assert.match(source, /itemSelector:"\.yx-coffee-card\[data-order-drag\]"/);
  assert.match(source, /handleSelector:"\[data-order-drag\]"/);
});
