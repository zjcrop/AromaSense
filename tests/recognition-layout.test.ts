import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { segmentSamples } from "../app/core/sample-layout-segmenter";

function line(text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    text,
    confidence: 0.98,
    polygon: [[left, top], [right, top], [right, bottom], [left, bottom]]
  };
}

test("segments a dense one-row-per-sample list in reading order", () => {
  const document = buildOCRLayoutDocument({
    imageId: "row-list",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      line("Ethiopia Guji | Washed | Gesha", 80, 100, 900, 150),
      line("Kenya Nyeri | Washed | SL28", 80, 210, 900, 260),
      line("Colombia Huila | Natural | Caturra", 80, 320, 900, 370)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "row-list");
  assert.equal(result.segments.length, 3);
  assert.match(result.segments[0]?.text ?? "", /Ethiopia/);
  assert.match(result.segments[2]?.text ?? "", /Colombia/);
});

test("segments vertically separated multi-line coffee blocks", () => {
  const document = buildOCRLayoutDocument({
    imageId: "vertical-blocks",
    sourceWidth: 1000,
    sourceHeight: 1200,
    lines: [
      line("产地 Ethiopia Guji", 80, 80, 500, 120),
      line("品种 Gesha", 80, 135, 360, 175),
      line("处理法 Washed", 80, 190, 420, 230),
      line("产地 Kenya Nyeri", 80, 430, 500, 470),
      line("品种 SL28", 80, 485, 340, 525),
      line("处理法 Washed", 80, 540, 420, 580)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "vertical-block-list");
  assert.equal(result.segments.length, 2);
  assert.match(result.segments[0]?.text ?? "", /Ethiopia/);
  assert.match(result.segments[1]?.text ?? "", /Kenya/);
});

test("recognizes a table header and emits body rows only", () => {
  const document = buildOCRLayoutDocument({
    imageId: "table",
    sourceWidth: 1000,
    sourceHeight: 800,
    lines: [
      line("产地", 40, 60, 180, 100),
      line("处理法", 300, 60, 450, 100),
      line("品种", 620, 60, 760, 100),
      line("Ethiopia Guji", 40, 160, 250, 200),
      line("Washed", 300, 160, 440, 200),
      line("Gesha", 620, 160, 750, 200),
      line("Kenya Nyeri", 40, 260, 250, 300),
      line("Washed", 300, 260, 440, 300),
      line("SL28", 620, 260, 730, 300)
    ]
  });
  const result = segmentSamples(document);
  assert.equal(result.layoutType, "table");
  assert.equal(result.segments.length, 2);
  assert.doesNotMatch(result.segments[0]?.text ?? "", /^产地/m);
});
