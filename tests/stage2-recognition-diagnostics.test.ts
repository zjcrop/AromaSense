import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { segmentSamples } from "../app/core/sample-layout-segmenter";
import { refineAmbiguousSingleSampleLayout } from "../app/core/sample-multi-entry-refinement";

function line(text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    text,
    confidence: 0.99,
    polygon: [[left, top], [right, top], [right, bottom], [left, bottom]]
  };
}

test("Stage 2: aligned side-by-side coffee cards remain two isolated records", () => {
  const document = buildOCRLayoutDocument({
    imageId: "stage2-side-by-side-cards",
    sourceWidth: 1200,
    sourceHeight: 800,
    lines: [
      line("Ethiopia Guji", 60, 90, 470, 135),
      line("Colombia Huila", 680, 90, 1110, 135),
      line("Gesha", 60, 185, 330, 230),
      line("Pink Bourbon", 680, 185, 1080, 230),
      line("Washed", 60, 280, 330, 325),
      line("Honey Process", 680, 280, 1000, 325),
      line("Jasmine Citrus", 60, 375, 470, 420),
      line("Peach Cacao", 680, 375, 1050, 420)
    ]
  });

  const primary = segmentSamples(document);
  const refined = refineAmbiguousSingleSampleLayout(document, primary);
  const diagnostic = {
    inputCoffeeCount: 2,
    geometry: "two-independent-columns-with-aligned-y-rows",
    primary: {
      layoutType: primary.layoutType,
      segments: primary.segments.length,
      texts: primary.segments.map((segment) => segment.text)
    },
    refined: {
      layoutType: refined.layoutType,
      segments: refined.segments.length,
      profiles: refined.segments.map((segment) => segment.hints?.profile ?? ""),
      texts: refined.segments.map((segment) => segment.text)
    },
    repairedBoundary: "pre-row side-by-side column refinement"
  };
  console.log(`STAGE2_MULTI_RECORD_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);

  // The primary geometry path still demonstrates why Stage 2 needed the repair:
  // aligned Y rows collapse the two cards before its later column clustering.
  assert.equal(primary.segments.length, 1);
  assert.match(primary.segments[0]?.text ?? "", /Ethiopia Guji[\s\S]*Colombia Huila/u);

  // The conservative refinement must restore record identity before semantic
  // parsing, and no field text may cross from one coffee into the other.
  assert.equal(refined.layoutType, "grid");
  assert.equal(refined.segments.length, 2);
  assert.equal(refined.requiresReview, true);
  assert.equal(refined.segments[0]?.hints?.profile, "side-by-side-columns-v1");
  assert.equal(refined.segments[1]?.hints?.profile, "side-by-side-columns-v1");

  const left = refined.segments[0]?.text ?? "";
  const right = refined.segments[1]?.text ?? "";
  assert.match(left, /Ethiopia Guji/u);
  assert.match(left, /Gesha/u);
  assert.match(left, /Washed/u);
  assert.doesNotMatch(left, /Colombia|Pink Bourbon|Honey Process|Peach Cacao/u);
  assert.match(right, /Colombia Huila/u);
  assert.match(right, /Pink Bourbon/u);
  assert.match(right, /Honey Process/u);
  assert.doesNotMatch(right, /Ethiopia|Gesha|Washed|Jasmine Citrus/u);
});

test("Stage 2: two visual columns without two independent coffee identities do not split", () => {
  const document = buildOCRLayoutDocument({
    imageId: "stage2-single-bag-two-column-design",
    sourceWidth: 1200,
    sourceHeight: 800,
    lines: [
      line("Ethiopia Guji", 70, 100, 470, 145),
      line("Tasting Notes", 710, 100, 1060, 145),
      line("Gesha", 70, 195, 300, 240),
      line("Jasmine", 710, 195, 980, 240),
      line("Washed", 70, 290, 320, 335),
      line("Peach", 710, 290, 930, 335),
      line("1950M", 70, 385, 300, 430),
      line("Citrus", 710, 385, 950, 430)
    ]
  });

  const primary = segmentSamples(document);
  const refined = refineAmbiguousSingleSampleLayout(document, primary);
  assert.equal(primary.segments.length, 1);
  assert.equal(refined.segments.length, 1);
  assert.notEqual(refined.segments[0]?.hints?.profile, "side-by-side-columns-v1");
});
