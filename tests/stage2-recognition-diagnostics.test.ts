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

test("Stage 2 diagnostic: aligned side-by-side coffee cards collapse before column grouping", () => {
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
      line("Honey", 680, 280, 960, 325),
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
      texts: refined.segments.map((segment) => segment.text)
    },
    suspectedBoundary: "row-construction-before-column-clustering"
  };
  console.log(`STAGE2_MULTI_RECORD_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);

  // Stage 2 deliberately records the current unsafe behavior rather than silently
  // changing Recognition semantics. The acceptance report decides the repair stage.
  assert.equal(primary.segments.length, 1, "primary segmenter no longer reproduces the Stage 2 collapse; update the diagnostic");
  assert.equal(refined.segments.length, 1, "refinement no longer reproduces the Stage 2 collapse; update the diagnostic");
  assert.match(primary.segments[0]?.text ?? "", /Ethiopia Guji[\s\S]*Colombia Huila/u);
  assert.match(primary.segments[0]?.text ?? "", /Washed[\s\S]*Honey/u);
});
