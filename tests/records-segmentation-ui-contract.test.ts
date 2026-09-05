import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("home records modal uses a plain dark overlay and paints loading state before the database query", () => {
  const app = source("app/runtime/dom-app.ts");
  const modalStyle = app.match(/\.home-modal\{[^}]+\}/u)?.[0] ?? "";
  assert.match(modalStyle, /background:rgba\(0,0,0,\.74\)/u);
  assert.doesNotMatch(modalStyle, /backdrop-filter/u);
  assert.match(app, /loading\.textContent = "正在读取杯测记录…"/u);
  assert.match(app, /requestAnimationFrame/u);
  assert.match(app, /new SessionRecordsReader\(this\.db\)\.list\(300\)/u);
});

test("record summary query preaggregates tables and only uses final scoring completion", () => {
  const records = source("app/storage/session-records-reader.ts");
  assert.match(records, /WITH[\s\S]*sample_stats AS/u);
  assert.match(records, /completion_stats AS/u);
  assert.match(records, /observation_stats AS/u);
  assert.match(records, /revision_stats AS/u);
  assert.match(records, /stage_id IN \('scoring', 'final'\)/u);
  assert.doesNotMatch(records, /flow\.stage_id IN \('aroma'/u);
});

test("segmentation review exposes direct dragging, both split directions, delete and whole AI rerun in the requested order", () => {
  const dialog = source("app/ui/dom/segmentation-review-dialog.ts");
  assert.match(dialog, /beginRegionDrag/u);
  assert.match(dialog, /setPointerCapture/u);
  assert.match(dialog, /seg-review__handle is-left/u);
  assert.match(dialog, /"横向拆分"/u);
  assert.match(dialog, /"纵向拆分"/u);
  assert.match(dialog, /splitSegmentationRegionVertically/u);
  assert.match(dialog, /"删除当前分区"/u);
  assert.match(dialog, /"整体交给AI"/u);
  assert.match(dialog, /tools\.append\(roi, reassignment, mergePrevious, mergeNext, splitHorizontal, splitVertical, remove, wholeAI\)/u);
  assert.doesNotMatch(dialog.match(/\.seg-review\{[^}]+\}/u)?.[0] ?? "", /backdrop-filter/u);
});

test("whole-page rerun stays on the production recognition delegate instead of recursing through the review decorator", () => {
  const recognizer = source("app/ui/dom/segmentation-review-recognizer.ts");
  assert.match(recognizer, /recognizeWholePage: \(\) => this\.delegate\.recognizePage\(file, index\)/u);
});
