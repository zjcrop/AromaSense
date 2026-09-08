import assert from "node:assert/strict";
import test from "node:test";
import {
  recognizeReviewedRegionsFromOriginal,
  type RegionBatchProgress
} from "../app/core/sample-region-batch-recognition";
import { buildSegmentationReviewModel, type SegmentationReviewModel } from "../app/core/sample-segmentation-review";
import type { RecognizedPage } from "../app/core/sample-recognition-service";

function stalePage(): RecognizedPage {
  return {
    input: { kind: "image", name: "camera.jpg" },
    rawText: "STALE KENYA\nSTALE ETHIOPIA",
    samples: [
      { rawText: "STALE KENYA", metadata: { country: "Old Kenya" }, recognition: { fields: [], conflicts: [] } },
      { rawText: "STALE ETHIOPIA", metadata: { country: "Old Ethiopia" }, recognition: { fields: [], conflicts: [] } }
    ],
    recognition: {
      source: "ocr",
      requiresReview: true,
      fields: [],
      conflicts: [],
      layout: {
        type: "multi-record",
        reviewRequired: true,
        records: [
          { id: "region-1", text: "STALE KENYA", box: { left: 0, top: 0, right: 1, bottom: 0.45 }, confidence: 0.7 },
          { id: "region-2", text: "STALE ETHIOPIA", box: { left: 0, top: 0.55, right: 1, bottom: 1 }, confidence: 0.7 }
        ]
      }
    }
  } as RecognizedPage;
}

function installFoundationFixture(options: { failSecond?: boolean } = {}) {
  const runtime = globalThis as typeof globalThis & {
    LuckyBeanRecognitionCore?: Record<string, unknown>;
    __AROMASENSE_RECOGNITION_BOOK__?: Record<string, unknown>;
  };
  const previousCore = runtime.LuckyBeanRecognitionCore;
  const previousBook = runtime.__AROMASENSE_RECOGNITION_BOOK__;
  const calls = {
    prepare: [] as Blob[],
    regions: [] as Array<Record<string, unknown>>
  };
  let regionCall = 0;

  runtime.LuckyBeanRecognitionCore = {
    async preparePackageImage(blob: Blob) {
      calls.prepare.push(blob);
      return { id: "prepared-source", blob, source: "original-file" };
    },
    normalizeRecognitionRegion(region: Record<string, unknown>) {
      return region;
    },
    async recognizeImageRegion(_prepared: unknown, region: Record<string, unknown>) {
      calls.regions.push(region);
      regionCall += 1;
      if (options.failSecond && regionCall === 2) throw new Error("fixture second region failed");
      const text = regionCall === 1 ? "FRESH KENYA WASHED" : "FRESH ETHIOPIA NATURAL";
      return {
        fullText: text,
        blocks: [
          {
            text,
            confidence: 0.98,
            box: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
            polygon: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
          }
        ],
        protocol: "recognition-roi/1.0"
      };
    }
  };

  runtime.__AROMASENSE_RECOGNITION_BOOK__ = {
    createRecognitionDocument(input: Record<string, unknown>) {
      return { schemaVersion: "fixture-doc/1", parserVersion: "fixture-parser/1", ...input };
    },
    analyzeRecognitionDocument(document: Record<string, unknown>) {
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
      onProgress: (state: RegionBatchProgress) => progress.push(state.fraction)
    });

    assert.equal(fixture.calls.prepare.length, 1, "the immutable source image must be prepared once for the whole region batch");
    assert.equal(fixture.calls.prepare[0], original);
    assert.equal(fixture.calls.regions.length, 2, "both reviewed regions must still receive an independent PP-OCR pass");
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
    assert.equal(fixture.calls.prepare.length, 1, "failed batches must not repeat source preparation");
    assert.equal(fixture.calls.regions.length, 2, "the second independent region pass must be the operation that fails");
  } finally {
    fixture.restore();
  }
});