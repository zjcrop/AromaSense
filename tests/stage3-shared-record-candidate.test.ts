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

async function withBundledLuckyBeanCore<T>(run: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "LuckyBeanRecognitionCore");
  const dynamicImport = (0, eval)("(specifier) => import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
  const core = await dynamicImport("luckybean-static-app/src/recognition-core.js");
  Object.defineProperty(globalThis, "LuckyBeanRecognitionCore", {
    configurable: true,
    writable: true,
    value: core
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "LuckyBeanRecognitionCore", descriptor);
    else Reflect.deleteProperty(globalThis, "LuckyBeanRecognitionCore");
  }
}

test("Stage 3: ambiguous side-by-side cards use the shared LuckyBean RecordCandidate contract", async () => {
  await withBundledLuckyBeanCore(() => {
    const document = buildOCRLayoutDocument({
      imageId: "stage3-shared-side-by-side",
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
    assert.equal(primary.segments.length, 1);

    const refined = refineAmbiguousSingleSampleLayout(document, primary);
    assert.equal(refined.layoutType, "grid");
    assert.equal(refined.segments.length, 2);
    assert.equal(refined.requiresReview, true);
    assert.equal(refined.segments[0]?.hints?.profile, "shared:geometry-side-by-side-v1");
    assert.equal(refined.segments[1]?.hints?.profile, "shared:geometry-side-by-side-v1");

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
});

test("Stage 3: shared RecordCandidate keeps a single two-column coffee package unsplit", async () => {
  await withBundledLuckyBeanCore(() => {
    const document = buildOCRLayoutDocument({
      imageId: "stage3-shared-single-package",
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
    assert.doesNotMatch(refined.segments[0]?.hints?.profile ?? "", /^shared:/u);
  });
});
