import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialog = readFileSync("app/ui/dom/segmentation-review-dialog.ts", "utf8");
const decorator = readFileSync("app/ui/dom/segmentation-review-recognizer.ts", "utf8");

test("segmentation review exposes geometry, ROI correction and apply without deterministic whole-page rerun", () => {
  assert.match(dialog, /局部重新识别/);
  assert.match(dialog, /按当前边界重新解析/);
  assert.match(dialog, /assignSegmentationLinesByGeometry/);
  assert.doesNotMatch(dialog, /整体交给AI|按当前边界归属文字|recognizeWholePage/);
  assert.doesNotMatch(decorator, /recognizeWholePage\s*:/);
});
