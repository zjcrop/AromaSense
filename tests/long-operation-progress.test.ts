import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LONG_OPERATION_PROGRESS_DELAY_MS,
  parseLongOperationStatus,
  shouldShowLongOperationProgress
} from "../app/ui/dom/long-operation-progress";

test("long-operation progress stays hidden until the task has exceeded ten seconds", () => {
  assert.equal(LONG_OPERATION_PROGRESS_DELAY_MS, 10_000);
  assert.equal(shouldShowLongOperationProgress(1_000, 10_999), false);
  assert.equal(shouldShowLongOperationProgress(1_000, 11_000), true);
  assert.equal(shouldShowLongOperationProgress(undefined, 99_999), false);
});

test("recognition and spreadsheet status expose only defensible batch progress", () => {
  assert.deepEqual(parseLongOperationStatus("识别 1/3：a.jpg · LuckyBean 正式识别核心"), {
    current: 1,
    total: 3,
    completed: 0,
    percent: 0,
    determinate: false
  });
  assert.deepEqual(parseLongOperationStatus("完成 2/4：b.jpg · 1 个样品"), {
    current: 2,
    total: 4,
    completed: 2,
    percent: 50,
    determinate: true
  });
  assert.deepEqual(parseLongOperationStatus("正在解析表格 3/5：samples.xlsx"), {
    current: 3,
    total: 5,
    completed: 2,
    percent: 40,
    determinate: true
  });
  assert.equal(parseLongOperationStatus("正在读取分享数据…"), undefined);
});

test("setup installs one shared delayed progress controller instead of patching OCR core", () => {
  const setupSource = readFileSync("app/ui/dom/batch-setup-renderer.ts", "utf8");
  const progressSource = readFileSync("app/ui/dom/long-operation-progress.ts", "utf8");
  assert.match(setupSource, /ensureLongOperationProgress\(root\)/);
  assert.match(progressSource, /root\.hasAttribute\("aria-busy"\)/);
  assert.match(progressSource, /\.batch-setup__status:not\(\[hidden\]\)/);
  assert.match(progressSource, /任务仍在执行；无需重复点击/);
  assert.doesNotMatch(progressSource, /recognizePage\(/);
});
