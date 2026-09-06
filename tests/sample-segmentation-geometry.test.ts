import assert from "node:assert/strict";
import test from "node:test";
import { assignSegmentationLinesByGeometry, type SegmentationReviewModel } from "../app/core/sample-segmentation-review";

function box(left: number, top: number, right: number, bottom: number) {
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

test("manual region geometry, not stale automatic lineIds, controls the next parse", () => {
  const model: SegmentationReviewModel = {
    fileName: "two-coffees.jpg",
    engine: "test-ocr",
    lines: [
      { id: "a-country", blockId: "a-country", text: "Ethiopia", confidence: 0.95, box: box(0.10, 0.12, 0.28, 0.18) },
      { id: "a-variety", blockId: "a-variety", text: "74158", confidence: 0.94, box: box(0.10, 0.23, 0.25, 0.29) },
      { id: "b-country", blockId: "b-country", text: "Panama", confidence: 0.96, box: box(0.62, 0.12, 0.78, 0.18) },
      { id: "b-variety", blockId: "b-variety", text: "Gesha", confidence: 0.97, box: box(0.63, 0.23, 0.78, 0.29) }
    ],
    regions: [
      // Deliberately stale/wrong ownership from the original auto-segmentation.
      { id: "left", label: "", box: box(0.04, 0.05, 0.42, 0.36), lineIds: ["a-country", "b-country"] },
      { id: "right", label: "", box: box(0.56, 0.05, 0.92, 0.36), lineIds: ["a-variety", "b-variety"] }
    ]
  };

  const reassigned = assignSegmentationLinesByGeometry(model);
  assert.deepEqual(reassigned.regions[0].lineIds, ["a-country", "a-variety"]);
  assert.deepEqual(reassigned.regions[1].lineIds, ["b-country", "b-variety"]);
});

test("one OCR line is assigned to at most one overlapping region", () => {
  const model: SegmentationReviewModel = {
    fileName: "overlap.jpg",
    engine: "test-ocr",
    lines: [{ id: "shared", blockId: "shared", text: "Gesha", confidence: 0.9, box: box(0.46, 0.20, 0.54, 0.26) }],
    regions: [
      { id: "left", label: "", box: box(0.20, 0.10, 0.53, 0.40), lineIds: [] },
      { id: "right", label: "", box: box(0.47, 0.10, 0.80, 0.40), lineIds: [] }
    ]
  };
  const reassigned = assignSegmentationLinesByGeometry(model);
  assert.equal(reassigned.regions.flatMap((region) => region.lineIds).filter((id) => id === "shared").length, 1);
});
