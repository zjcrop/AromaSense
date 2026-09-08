import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estimateRegionBatchRemainingMs } from "../app/core/sample-region-batch-recognition";

test("region ETA never multiplies one-time cold start across remaining crops", () => {
  assert.equal(estimateRegionBatchRemainingMs([], 3), undefined);
  // The first region may contain model download, Worker bootstrap or a one-off
  // ONNX compatibility rebuild. It is intentionally not converted into an ETA.
  assert.equal(estimateRegionBatchRemainingMs([30_000], 3), undefined);
  const steady = estimateRegionBatchRemainingMs([30_000, 3_800, 4_200], 3);
  assert.ok(steady !== undefined && steady >= 9_000 && steady <= 15_000, `steady ETA invalid: ${steady}`);
});

test("region OCR prepares original once and bounds each web ROI", () => {
  const roi = readFileSync("app/core/sample-roi-refinement.ts", "utf8");
  const batch = readFileSync("app/core/sample-region-batch-recognition.ts", "utf8");
  assert.match(roi, /preparedImage\?: LuckyBeanPreparedImage/u);
  assert.match(roi, /input\.preparedImage \?\? await core\.preparePackageImage/u);
  assert.match(roi, /REVIEWED_REGION_MAX_EDGE = 1024/u);
  assert.match(roi, /maxEdge: REVIEWED_REGION_MAX_EDGE/u);
  assert.doesNotMatch(roi, /maxEdge: 2200/u);
  assert.match(batch, /const preparedImage = await requireLuckyBeanRecognitionCore\(\)\.preparePackageImage\(input\.file\)/u);
  assert.match(batch, /preparedImage,/u);
});

test("ambiguous pages segment before optional AI and generic ETA is not percent-derived", () => {
  const service = readFileSync("app/core/sample-recognition-service.ts", "utf8");
  const progress = readFileSync("app/ui/dom/long-operation-progress.ts", "utf8");
  assert.match(service, /!layout\.requiresReview && harvest\.shouldUseStructureAi/u);
  assert.match(service, /segmentation-review-before-ai/u);
  assert.doesNotMatch(progress, /elapsedMs \/ Math\.max\(0\.03, confirmed \/ 100\)/u);
  assert.match(progress, /INITIAL_ESTIMATED_TOTAL_MS = 30_000/u);
  assert.match(progress, /MAX_ESTIMATED_TOTAL_MS = 60_000/u);
});
