import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("setup replaces direct mode buttons with one centered four-mode cupping type select and no visible caption", () => {
  const source = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
  assert.doesNotMatch(source, /caption\.textContent = "杯测类型"/);
  assert.doesNotMatch(source, /batch-setup__cupping-type-label/);
  assert.match(source, /select\.setAttribute\("aria-label", "杯测类型"\)/);
  assert.match(source, /text-align:center;text-align-last:center/);
  assert.match(source, /for \(const mode of CUPPING_MODES\)/);
  assert.match(source, /\.batch-setup__target-direct"\)\?\.remove\(\)/);
  assert.match(source, /\.batch-setup__target-help"\)\?\.remove\(\)/);
  assert.doesNotMatch(source, /公开杯测为默认；盲测无需录入/);

  const homeEnhancements = readFileSync("app/ui/dom/home-action-enhancements.ts", "utf8");
  assert.match(homeEnhancements, /\.batch-setup__session-meta-input\{[\s\S]*?text-align:center!important;[\s\S]*?text-align-last:center!important;/);
});

test("free runtime uses one effective rail scroll layer and reviewed production OCR additions", () => {
  const source = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(source, /if \(!policy\.timerEnabled\)/);
  assert.match(source, /\[data-cupping-timer\], \.cupping-completion-stamp/);
  assert.match(source, /\.cupping-layout__rail-list\.sample-rail\{[^}]*overflow-y:auto!important[^}]*touch-action:pan-y!important/s);
  assert.match(source, /\.sample-rail__active-tab\{display:none!important\}/);
  assert.match(source, /manage\.textContent = "豆子管理"/);
  assert.match(source, /edit\.textContent = "编辑"/);
  assert.match(source, /add\.textContent = "\+ 拍照识别添加豆子"/);
  assert.match(source, /SegmentationReviewRecognitionService/);
  assert.match(source, /runtimeRecognizer\.recognizePage\(file, 0\)/);
  assert.match(source, /openBatchReviewDialog/);
  assert.match(source, /onConfirm: async \(value: BatchReviewValue\)/);
  const confirmation = source.indexOf("onConfirm: async (value: BatchReviewValue)");
  const write = source.indexOf("await this.controller.addSample", confirmation);
  assert.ok(confirmation >= 0 && write > confirmation, "runtime bean must be persisted only inside the confirmation path");
  assert.match(source, /free-cupping-manager__progress-percent/);
  assert.match(source, /dataset\.longOperationLabel/);
  assert.match(source, /stageId: "aroma"/);
  assert.match(source, /back\.textContent = "返回添加前进程"/);
  assert.match(source, /restoreContext\(target\)/);
  assert.match(source, /controller\.deleteSample/);
  assert.match(source, /cuppingModeFromMetadata\(state\.sessionMetadata\) !== "free"/);
  assert.doesNotMatch(source, /controller\.addSample\(crypto\.randomUUID\(\), \{ metadata: \{\} \}/);
});

test("unfinished free records expose an edit entry that reuses the same session", () => {
  const records = readFileSync("app/ui/dom/session-records-renderer.ts", "utf8");
  const app = readFileSync("app/runtime/dom-app.ts", "utf8");
  const reader = readFileSync("app/storage/session-records-reader.ts", "utf8");
  assert.match(records, /cuppingModeFromMetadata\(record\.metadata\) === "free"/);
  assert.match(records, /"编辑", \(\) => this\.options\.onEdit/);
  assert.match(app, /private async openSessionEditor\(sessionId: string\)/);
  assert.match(app, /await this\.openSession\(sessionId\);\s*await this\.screen\?\.openEditor\(\);/s);
  assert.match(reader, /normalizeSessionMetadata\(value\)/);
});
