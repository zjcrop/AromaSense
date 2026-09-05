import assert from "node:assert/strict";
import test from "node:test";
import type { OCRBox } from "../app/core/ocr-layout-model";
import {
  buildSegmentationReviewModel,
  linesInsideBox,
  mergeSegmentationRegions,
  resegmentRecognizedPage,
  splitSegmentationRegion,
  type SegmentationReviewModel
} from "../app/core/sample-segmentation-review";
import type { RecognizedPage, RecognizedSample } from "../app/core/sample-recognition-service";

function box(left: number, top: number, right: number, bottom: number): OCRBox {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function sample(label: string, id: string, lines: Array<{ id: string; text: string; box: OCRBox }>): RecognizedSample {
  return {
    label,
    rawText: lines.map((line) => line.text).join("\n"),
    engine: "fixture-ocr",
    confidence: 0.7,
    requiresReview: true,
    metadata: {
      recognition: {
        segmentId: id,
        segmentBox: box(
          Math.min(...lines.map((line) => line.box.left)),
          Math.min(...lines.map((line) => line.box.top)),
          Math.max(...lines.map((line) => line.box.right)),
          Math.max(...lines.map((line) => line.box.bottom))
        ),
        evidenceLines: lines.map((line) => ({
          id: line.id,
          blockId: `${line.id}-block`,
          text: line.text,
          confidence: 0.8,
          box: line.box
        }))
      }
    }
  };
}

function fixturePage(): RecognizedPage {
  return {
    fileName: "menu.jpg",
    engine: "fixture-ocr",
    layoutType: "mixed",
    segmentationConfidence: 0.48,
    requiresSegmentationReview: true,
    samples: [
      sample("Kenya AA", "seg-1", [
        { id: "l1", text: "Kenya", box: box(0.1, 0.1, 0.45, 0.16) },
        { id: "l2", text: "Washed", box: box(0.1, 0.18, 0.45, 0.24) }
      ]),
      sample("Ethiopia Natural", "seg-2", [
        { id: "l3", text: "Ethiopia", box: box(0.1, 0.56, 0.48, 0.62) },
        { id: "l4", text: "Natural", box: box(0.1, 0.64, 0.48, 0.70) }
      ])
    ]
  };
}

function installFoundationFixture(): () => void {
  const runtime = globalThis as typeof globalThis & {
    LuckyBeanRecognitionCore?: unknown;
    __AROMASENSE_RECOGNITION_BOOK__?: unknown;
  };
  const previousCore = runtime.LuckyBeanRecognitionCore;
  const previousBook = runtime.__AROMASENSE_RECOGNITION_BOOK__;
  runtime.__AROMASENSE_RECOGNITION_BOOK__ = {
    countries: [{}], regions: [{}], entities: [{}], varieties: [{}], processes: [{}], flavors: [{}]
  };
  runtime.LuckyBeanRecognitionCore = {
    RECOGNITION_PIPELINE_VERSION: "fixture-pipeline/1",
    async preparePackageImage(blob: Blob) { return { blob }; },
    async recognizeCoffeeBag() { return { blocks: [], fullText: "" }; },
    createRecognitionDocument(input: Record<string, unknown>) {
      return { schemaVersion: "fixture-doc/1", parserVersion: "fixture-parser/1", ...input };
    },
    analyzeRecognitionDocument(document: Record<string, unknown>) {
      const text = String(document.fullText ?? "");
      const fields = [] as Array<Record<string, unknown>>;
      if (/Kenya/iu.test(text)) fields.push({ field: "countryCode", standardValue: "Kenya", confidence: 0.94, status: "resolved" });
      if (/Ethiopia/iu.test(text)) fields.push({ field: "countryCode", standardValue: "Ethiopia", confidence: 0.93, status: "resolved" });
      if (/Washed/iu.test(text)) fields.push({ field: "processCode", standardValue: "Washed", confidence: 0.9, status: "resolved" });
      if (/Natural/iu.test(text)) fields.push({ field: "processCode", standardValue: "Natural", confidence: 0.91, status: "resolved" });
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
  return () => {
    runtime.LuckyBeanRecognitionCore = previousCore;
    runtime.__AROMASENSE_RECOGNITION_BOOK__ = previousBook;
  };
}

test("segmentation review model preserves OCR geometry and supports box reassignment", () => {
  const model = buildSegmentationReviewModel(fixturePage());
  assert.ok(model);
  assert.equal(model.lines.length, 4);
  assert.equal(model.regions.length, 2);
  assert.deepEqual(linesInsideBox(model.lines, box(0, 0, 0.6, 0.3)), ["l1", "l2"]);
});

test("manual regions can merge and split without inventing or duplicating OCR lines", () => {
  const model = buildSegmentationReviewModel(fixturePage()) as SegmentationReviewModel;
  const merged = mergeSegmentationRegions(model, 0, 1);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].lineIds), new Set(["l1", "l2", "l3", "l4"]));

  const mergedModel = { ...model, regions: merged };
  const split = splitSegmentationRegion(mergedModel, 0, 0.4);
  assert.equal(split.length, 2);
  assert.deepEqual(split[0].lineIds, ["l1", "l2"]);
  assert.deepEqual(split[1].lineIds, ["l3", "l4"]);
});

test("applying reviewed regions reruns Foundation semantic parsing and clears segmentation review", () => {
  const restore = installFoundationFixture();
  try {
    const page = fixturePage();
    const model = buildSegmentationReviewModel(page) as SegmentationReviewModel;
    const reviewed = resegmentRecognizedPage(page, model);
    assert.equal(reviewed.requiresSegmentationReview, false);
    assert.equal(reviewed.segmentationConfidence, 1);
    assert.equal(reviewed.samples.length, 2);
    assert.equal(reviewed.samples[0].metadata.country, "Kenya");
    assert.equal(reviewed.samples[0].metadata.process, "Washed");
    assert.equal(reviewed.samples[1].metadata.country, "Ethiopia");
    assert.equal(reviewed.samples[1].metadata.process, "Natural");
    const recognition = reviewed.samples[0].metadata.recognition as Record<string, unknown>;
    assert.equal(recognition.manualSegmentation, true);
    assert.equal(recognition.schemaVersion, "aromasense-recognition/3.3");
  } finally {
    restore();
  }
});

test("reviewed page rejects the same OCR line being assigned to multiple samples", () => {
  const restore = installFoundationFixture();
  try {
    const page = fixturePage();
    const model = buildSegmentationReviewModel(page) as SegmentationReviewModel;
    const conflicting = {
      ...model,
      regions: [
        model.regions[0],
        { ...model.regions[1], lineIds: [...model.regions[1].lineIds, "l1"] }
      ]
    };
    assert.throws(() => resegmentRecognizedPage(page, conflicting), /被分配到多个样品/u);
  } finally {
    restore();
  }
});
