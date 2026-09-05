import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoffeeFoundationGateway } from "../app/core/coffee-foundation-runtime";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { segmentSamples } from "../app/core/sample-layout-segmenter";
import { refineAmbiguousSingleSampleLayout } from "../app/core/sample-multi-entry-refinement";

function line(text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    text,
    confidence: 0.98,
    polygon: [[left, top], [right, top], [right, bottom], [left, bottom]]
  };
}

function refined(lines: readonly OCRLineInput[], height = 1000) {
  const document = buildOCRLayoutDocument({ imageId: "refinement", sourceWidth: 1000, sourceHeight: height, lines });
  return refineAmbiguousSingleSampleLayout(document, segmentSamples(document));
}

test("separates multiple plain coffee rows without explicit field labels or delimiters", () => {
  const result = refined([
    line("Ethiopia Guji Washed Gesha", 80, 100, 880, 145),
    line("Kenya Nyeri Washed SL28", 80, 220, 850, 265),
    line("Colombia Huila Natural Caturra", 80, 340, 900, 385)
  ]);
  assert.equal(result.layoutType, "row-list");
  assert.equal(result.segments.length, 3);
  assert.equal(result.requiresReview, true);
  assert.match(result.segments[0]?.text ?? "", /Ethiopia/);
  assert.match(result.segments[1]?.text ?? "", /Kenya/);
  assert.match(result.segments[2]?.text ?? "", /Colombia/);
});

test("separates vertically spaced unlabeled multi-line coffee cards", () => {
  const result = refined([
    line("ETHIOPIA GUJI", 80, 80, 500, 125),
    line("WASHED", 80, 140, 300, 185),
    line("GESHA", 80, 200, 300, 245),
    line("KENYA NYERI", 80, 520, 500, 565),
    line("WASHED", 80, 580, 300, 625),
    line("SL28", 80, 640, 300, 685)
  ]);
  assert.equal(result.layoutType, "vertical-block-list");
  assert.equal(result.segments.length, 2);
  assert.equal(result.requiresReview, true);
  assert.match(result.segments[0]?.text ?? "", /ETHIOPIA GUJI[\s\S]*WASHED[\s\S]*GESHA/);
  assert.match(result.segments[1]?.text ?? "", /KENYA NYERI[\s\S]*WASHED[\s\S]*SL28/);
});

test("does not split a single coffee bag that only repeats flavor descriptions", () => {
  const document = buildOCRLayoutDocument({
    imageId: "single-flavor",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      line("ETHIOPIA GUJI HAMBELA", 80, 100, 800, 145),
      line("風味描述｜茉莉、柑橘、白桃", 80, 180, 760, 225),
      line("CUPPING PROFILE", 80, 330, 520, 375),
      line("風味描述｜冷卻後莓果與蜂蜜", 80, 410, 760, 455)
    ]
  });
  const primary = segmentSamples(document);
  const result = refineAmbiguousSingleSampleLayout(document, primary);
  assert.equal(result.layoutType, "single");
  assert.equal(result.segments.length, 1);
});

test("Coffee Foundation gateway does not parse the recognition book when the homepage is created", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let reads = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem() { reads += 1; return null; } }
  });
  try {
    createCoffeeFoundationGateway();
    assert.equal(reads, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  }
});

test("web startup no longer warms recognition before the user requests it", () => {
  const source = readFileSync("app/runtime/web-entry.ts", "utf8");
  assert.doesNotMatch(source, /app\.warmRecognition\s*\(/u);
  assert.match(source, /图像识别按需加载/u);
});
