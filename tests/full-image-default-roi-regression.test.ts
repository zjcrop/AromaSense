import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("segmentation decorator keeps whole-image recognition as default and automatic segmentation explicit", () => {
  const source = readFileSync("app/ui/dom/segmentation-review-recognizer.ts", "utf8");
  assert.match(source, /override async recognizePage[\s\S]*return this\.delegate\.recognizePage\(file, index\)/);
  assert.match(source, /recognizeWithAutomaticSegmentation/);
  assert.match(source, /openSegmentationReviewDialogV2/);
  const defaultBody = source.match(/override async recognizePage[\s\S]*?\n  }/)?.[0] ?? "";
  assert.doesNotMatch(defaultBody, /openSegmentationReviewDialogV2/);
});

test("manual ROI supplement is exposed from confirmation without overwriting full-image evidence", () => {
  const dialog = readFileSync("app/ui/dom/batch-review-dialog.ts", "utf8");
  const core = readFileSync("app/core/sample-manual-roi-recognition.ts", "utf8");
  const picker = readFileSync("app/ui/dom/manual-roi-recognition-dialog.ts", "utf8");
  assert.match(dialog, /框选补充识别/);
  assert.match(core, /recognizeManualROIFromOriginal/);
  assert.match(core, /source: "manual_roi"/);
  assert.match(core, /manual_roi_conflict/);
  assert.match(core, /refineSegmentationRegionEvidence/);
  assert.match(core, /untouched original File|original File/);
  assert.match(picker, /createSegmentationImagePreview/);
  assert.match(picker, /原始照片裁取该区域/);
});

test("setup and runtime add-bean flows retain original File for optional ROI supplement", () => {
  const setup = readFileSync("app/ui/dom/batch-setup-review-renderer.ts", "utf8");
  const runtime = readFileSync("app/ui/dom/stable-cupping-screen-renderer.ts", "utf8");
  assert.match(setup, /sourceFile\?: File/);
  assert.match(setup, /openManualROIRecognitionDialog/);
  assert.match(setup, /整图识别/);
  assert.match(runtime, /openManualROIRecognitionDialog/);
  assert.match(runtime, /默认直接整图 PP-OCRv5 识别/);
});
