import assert from "node:assert/strict";
import test from "node:test";
import type { OCRBox } from "../app/core/ocr-layout-model";
import { proposeSampleRegionsFromGeometry } from "../app/core/sample-region-engine";

function box(left: number, top: number, right: number, bottom: number): OCRBox {
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

const geometry = [
  { id: "a1", box: box(0.08, 0.08, 0.34, 0.13) },
  { id: "a2", box: box(0.09, 0.15, 0.31, 0.20) },
  { id: "a3", box: box(0.09, 0.22, 0.35, 0.27) },
  { id: "b1", box: box(0.62, 0.09, 0.90, 0.14) },
  { id: "b2", box: box(0.63, 0.16, 0.88, 0.21) },
  { id: "b3", box: box(0.63, 0.23, 0.91, 0.28) }
];

test("region proposals split spatially separated sample blocks", () => {
  const result = proposeSampleRegionsFromGeometry(geometry);
  assert.equal(result.strategy, "geometry-only/1.0");
  assert.equal(result.regions.length, 2);
  assert.deepEqual(new Set(result.regions[0].lineIds), new Set(["a1", "a2", "a3"]));
  assert.deepEqual(new Set(result.regions[1].lineIds), new Set(["b1", "b2", "b3"]));
});

test("region proposals are invariant to OCR text because text is not an input feature", () => {
  const wrongText = geometry.map((line, index) => ({ ...line, text: `WRONG-${index}` }));
  const changedText = geometry.map((line, index) => ({ ...line, text: `COMPLETELY-DIFFERENT-${index}` }));
  const first = proposeSampleRegionsFromGeometry(wrongText);
  const second = proposeSampleRegionsFromGeometry(changedText);
  assert.deepEqual(first, second);
});

test("region proposal boxes stay normalized and carry geometric evidence", () => {
  const result = proposeSampleRegionsFromGeometry(geometry);
  for (const region of result.regions) {
    assert.ok(region.box.left >= 0 && region.box.top >= 0);
    assert.ok(region.box.right <= 1 && region.box.bottom <= 1);
    assert.ok(region.box.right > region.box.left && region.box.bottom > region.box.top);
    assert.ok(region.confidence > 0 && region.confidence <= 1);
    assert.ok(region.evidence.includes("ocr-box-geometry"));
  }
});
