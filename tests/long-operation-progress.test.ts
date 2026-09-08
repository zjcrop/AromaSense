import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LONG_OPERATION_PROGRESS_DELAY_MS,
  parseLongOperationStatus,
  shouldShowLongOperationProgress
} from "../app/ui/dom/long-operation-progress";

test("long-operation progress starts immediately with the busy task", () => {
  assert.equal(LONG_OPERATION_PROGRESS_DELAY_MS, 0);
  assert.equal(shouldShowLongOperationProgress(1_000, 1_000), true);
  assert.equal(shouldShowLongOperationProgress(1_000, 1_001), true);
  assert.equal(shouldShowLongOperationProgress(undefined, 99_999), false);
});

test("recognition and spreadsheet status expose monotonic stage progress", () => {
  assert.deepEqual(parseLongOperationStatus("识别 1/3：a.jpg · LuckyBean 正式识别核心"), {
    current: 1,
    total: 3,
    completed: 0,
    percent: 6,
    determinate: true
  });
  assert.deepEqual(parseLongOperationStatus("完成 2/4：b.jpg · 1 个样品"), {
    current: 2,
    total: 4,
    completed: 2,
    percent: 50,
    determinate: true
  });
  const spreadsheet = parseLongOperationStatus("正在解析表格 3/5：samples.xlsx");
  assert.equal(spreadsheet?.current, 3);
  assert.equal(spreadsheet?.total, 5);
  assert.equal(spreadsheet?.completed, 2);
  assert.equal(spreadsheet?.determinate, true);
  assert.ok(Math.abs(Number(spreadsheet?.percent) - 42) < 1e-9);
  assert.equal(parseLongOperationStatus("正在读取分享数据…"), undefined);
});

test("setup installs one shared immediate one-way progress controller instead of patching OCR core", () => {
  const setupSource = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
  const progressSource = readFileSync("app/ui/dom/long-operation-progress.ts", "utf8");
  assert.match(setupSource, /ensureLongOperationProgress\(root\)/);
  assert.match(progressSource, /root\.hasAttribute\("aria-busy"\)/);
  assert.match(progressSource, /coffee-foundation:ocr-progress/);
  assert.match(progressSource, /Math\.max\(this\.latestPercent/);
  assert.match(progressSource, /进度只向右推进/);
  assert.doesNotMatch(progressSource, /infinite/);
  assert.doesNotMatch(progressSource, /@keyframes/);
  assert.doesNotMatch(progressSource, /recognizePage\(/);
});
