import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { sharedRecordCandidateLayout } from "../app/core/shared-record-candidate-layout";

function line(id: string, text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    id,
    blockId: id,
    text,
    confidence: 0.98,
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

test("Stage 3 gate: shared vertical RecordCandidates map to two AromaSense samples with exact block identity", async () => {
  await withBundledLuckyBeanCore(() => {
    const document = buildOCRLayoutDocument({
      imageId: "stage3-shared-vertical",
      sourceWidth: 1200,
      sourceHeight: 800,
      lines: [
        line("a-origin", "Ethiopia Guji", 80, 50, 440, 75),
        line("a-variety", "Gesha", 80, 95, 260, 120),
        line("a-process", "Natural", 80, 140, 300, 165),
        line("a-flavor", "Jasmine", 80, 185, 300, 210),
        line("b-origin", "Kenya Nyeri", 80, 430, 440, 455),
        line("b-variety", "SL28", 80, 475, 260, 500),
        line("b-process", "Washed", 80, 520, 300, 545),
        line("b-flavor", "Blackcurrant", 80, 565, 360, 590)
      ]
    });

    const shared = sharedRecordCandidateLayout(document);
    assert.ok(shared);
    assert.equal(shared.layoutType, "vertical-block-list");
    assert.equal(shared.requiresReview, true);
    assert.equal(shared.segments.length, 2);
    assert.equal(shared.segments[0]?.hints?.profile, "shared:geometry-vertical-gap-v1");
    assert.equal(shared.segments[1]?.hints?.profile, "shared:geometry-vertical-gap-v1");
    assert.deepEqual(shared.segments[0]?.lines.map((item) => item.id), ["a-origin", "a-variety", "a-process", "a-flavor"]);
    assert.deepEqual(shared.segments[1]?.lines.map((item) => item.id), ["b-origin", "b-variety", "b-process", "b-flavor"]);
    assert.match(shared.segments[0]?.text ?? "", /Ethiopia Guji/u);
    assert.doesNotMatch(shared.segments[0]?.text ?? "", /Kenya Nyeri/u);
    assert.match(shared.segments[1]?.text ?? "", /Kenya Nyeri/u);
    assert.doesNotMatch(shared.segments[1]?.text ?? "", /Ethiopia Guji/u);
  });
});

test("Stage 3 gate: adapter returns undefined when the shared Recognition runtime is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "LuckyBeanRecognitionCore");
  Reflect.deleteProperty(globalThis, "LuckyBeanRecognitionCore");
  try {
    const document = buildOCRLayoutDocument({
      imageId: "stage3-no-runtime",
      sourceWidth: 800,
      sourceHeight: 600,
      lines: [line("origin", "Ethiopia Guji", 60, 80, 360, 120), line("process", "Natural", 60, 150, 300, 190)]
    });
    assert.equal(sharedRecordCandidateLayout(document), undefined);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "LuckyBeanRecognitionCore", descriptor);
  }
});
