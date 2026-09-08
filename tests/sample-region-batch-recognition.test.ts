import assert from "node:assert/strict";
import test from "node:test";
import type { OCRBox } from "../app/core/ocr-layout-model";
import { recognizeReviewedRegionsFromOriginal } from "../app/core/sample-region-batch-recognition";
import { buildSegmentationReviewModel, type SegmentationReviewModel } from "../app/core/sample-segmentation-review";
import type { RecognizedPage, RecognizedSample } from "../app/core/sample-recognition-service";
import type { LuckyBeanRecognitionCore } from "../app/core/luckybean-upstream-adapter";

function box(left: number, top: number, right: number, bottom: number): OCRBox {
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function staleSample(label: string, id: string, text: string, region: OCRBox): RecognizedSample {
  return {
    label,
    rawText: text,
    engine: "stale-first-pass",
    confidence: 0.4,
    requiresReview: true,
    metadata: {
      recognition: {
        segmentId: id,
        segmentBox: region,
        evidenceLines: [{
          id: `${id}-stale`,
          blockId: `${id}-stale-block`,
          text,
          confidence: 0.4,
          box: region
        }]
      }
    }
  };
}

function stalePage(): RecognizedPage {
  return {
    fileName: "original-camera.jpg",
    engine: "stale-first-pass",
    layoutType: "mixed",
    segmentationConfidence: 0.42,
    requiresSegmentationReview: true,
    samples: [
      staleSample("wrong-one", "seg-1", "STALE COLOMBIA", box(0.06, 0.08, 0.44, 0.38)),
      staleSample("wrong-two", "seg-2", "STALE BRAZIL", box(0.56, 0.08, 0.94, 0.38))
    ]
  };
}

function installFoundationFixture(options: { failSecond?: boolean } = {}): { restore(): void; calls: { prepare: Blob[]; regions: unknown[] } } {
  const runtime = globalThis as typeof globalThis & {
    LuckyBeanRecognitionCore?: LuckyBeanRecognitionCore;
    __AROMASENSE_RECOGNITION_BOOK__?: unknown;
  };
  const previousCore = runtime.LuckyBeanRecognitionCore;
  const previousBook = runtime.__AROMASENSE_RECOGNITION_BOOK__;
  const calls = { prepare: [] as Blob[], regions: [] as unknown[] };
  let regionCall = 0;

  runtime.__AROMASENSE_RECOGNITION_BOOK__ = {
    countries: [{}], regions: [{}], entities: [{}], varieties: [{}], processes: [{}], flavors: [{}]
  };
  runtime.LuckyBeanRecognitionCore = {
    RECOGNITION_PIPELINE_VERSION: "fixture-pipeline/1",
    async preparePackageImage(blob: Blob) {
      calls.prepare.push(blob);
      return { blob };
    },
    async recognizeCoffeeBag() { return { blocks: [], fullText: "" }; },
    getRecognitionCapabilities() { return { webPaddleRegion: true }; },
    async recognizeImageRegion(_image, region) {
      regionCall += 1;
      calls.regions.push(region);
      if (options.failSecond && regionCall === 2) throw new Error("fixture second region failed");
      const text = regionCall === 1 ? "FRESH KENYA WASHED" : "FRESH ETHIOPIA NATURAL";
      return {
        regionProtocol: "recognition-roi/1.0",
        engine: "fixture-roi",
        sourceWidth: 4032,
        sourceHeight: 3024,
        cropWidth: 1500,
        cropHeight: 1000,
        outputWidth: 1200,
        outputHeight: 800,
        fullText: text,
        blocks: [{
          text,
          confidence: 0.98,
          polygon: [[0.05, 0.10], [0.95, 0.10], [0.95, 0.35], [0.05, 0.35]]
        }]
      };
    },
    createRecognitionDocument(input) {
      return { schemaVersion: "fixture-doc/1", parserVersion: "fixture-parser/1", ...input };
    },
    analyzeRecognitionDocument(document) {
      const text = String(document.fullText ?? "");
      const fields = [] as Array<Record<string, unknown>>;
      if (/KENYA/iu.test(text)) fields.push({ field: "countryCode", standardValue: "Kenya", confidence: 0.98, status: "resolved" });
      if (/ETHIOPIA/iu.test(text)) fields.push({ field: "countryCode", standardValue: "Ethiopia", confidence: 0.98, status: "resolved" });
      if (/WASHED/iu.test(text)) fields.push({ field: "processCode", standardValue: "Washed", confidence: 0.97, status: "resolved" });
      if (/NATURAL/iu.test(text)) fields.push({ field: "processCode", standardValue: "Natural", confidence: 0.97, status: "resolved" });
      return {
        pipelineVersion: "fixture-pipeline/1",
        document,
        fields,
        parsed: {},
        resolvedCount: fields.length,
        reviewCount: 0,
        semanticText: text
      };
    }
  };

  return {
    calls,
    restore() {
      runtime.LuckyBeanRecognitionCore = previousCore;
      runtime.__AROMASENSE_RECOGNITION_BOOK__ = previousBook;
    }
  };
}

test("reviewed regions are all re-recognized from the original File and stale text is replaced", async () => {
  const fixture = installFoundationFixture();
  try {
    const page = stalePage();
    const model = buildSegmentationReviewModel(page) as SegmentationReviewModel;
    const original = new File([new Uint8Array([1, 2, 3, 4])], "original-camera.jpg", { type: "image/jpeg" });
    const progress: number[] = [];
    const result = await recognizeReviewedRegionsFromOriginal({
      file: original,
      page,
      model,
      onProgress: (state) => progress.push(state.fraction)
    });

    assert.equal(fixture.calls.prepare.length, 2);
    assert.ok(fixture.calls.prepare.every((blob) => blob === original));
    assert.equal(fixture.calls.regions.length, 2);
    assert.equal(result.page.samples.length, 2);
    assert.match(result.page.samples[0].rawText, /FRESH KENYA WASHED/u);
    assert.match(result.page.samples[1].rawText, /FRESH ETHIOPIA NATURAL/u);
    assert.doesNotMatch(result.page.samples.map((sample) => sample.rawText).join("\n"), /STALE/u);
    assert.equal(result.page.samples[0].metadata.country, "Kenya");
    assert.equal(result.page.samples[1].metadata.country, "Ethiopia");
    assert.equal(progress.at(-1), 1);
  } finally {
    fixture.restore();
  }
});

test("batch stops instead of silently finalizing stale evidence when any original-image region fails", async () => {
  const fixture = installFoundationFixture({ failSecond: true });
  try {
    const page = stalePage();
    const model = buildSegmentationReviewModel(page) as SegmentationReviewModel;
    const original = new File([new Uint8Array([9, 8, 7])], "original-camera.jpg", { type: "image/jpeg" });
    await assert.rejects(
      recognizeReviewedRegionsFromOriginal({ file: original, page, model }),
      /fixture second region failed/u
    );
    assert.equal(fixture.calls.prepare.length, 2);
  } finally {
    fixture.restore();
  }
});
