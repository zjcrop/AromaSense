import assert from "node:assert/strict";
import test from "node:test";
import type { OCRBox } from "../app/core/ocr-layout-model";
import {
  ROI_RECOGNITION_PROTOCOL,
  attachROIRefinementProvenance,
  mapRegionPolygonToPage,
  refineSegmentationRegionEvidence,
  regionRecognitionAvailable
} from "../app/core/sample-roi-refinement";
import type { SegmentationReviewModel } from "../app/core/sample-segmentation-review";
import type { RecognizedPage } from "../app/core/sample-recognition-service";

function box(left: number, top: number, right: number, bottom: number): OCRBox {
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function fixtureModel(): SegmentationReviewModel {
  return {
    fileName: "menu.jpg",
    engine: "fixture",
    lines: [
      { id: "old-1", blockId: "old-b1", text: "Old", confidence: 0.6, box: box(0.2, 0.2, 0.4, 0.3) },
      { id: "other-1", blockId: "other-b1", text: "Other", confidence: 0.8, box: box(0.55, 0.55, 0.8, 0.65) }
    ],
    regions: [
      { id: "r1", label: "A", box: box(0.1, 0.1, 0.5, 0.5), lineIds: ["old-1"] },
      { id: "r2", label: "B", box: box(0.5, 0.5, 0.9, 0.9), lineIds: ["other-1"] }
    ]
  };
}

function fixturePage(): RecognizedPage {
  return {
    fileName: "menu.jpg",
    engine: "fixture",
    layoutType: "mixed",
    segmentationConfidence: 0.5,
    requiresSegmentationReview: true,
    samples: [
      { label: "A", rawText: "Old", engine: "fixture", requiresReview: true, metadata: { recognition: {} } },
      { label: "B", rawText: "Other", engine: "fixture", requiresReview: true, metadata: { recognition: {} } }
    ]
  };
}

test("ROI local pixels map back into the page-normalized segment box", () => {
  const mapped = mapRegionPolygonToPage(
    [{ x: 20, y: 10 }, { x: 80, y: 40 }],
    box(0.2, 0.3, 0.6, 0.7),
    100,
    50
  );
  assert.deepEqual(mapped, [
    { x: 0.28, y: 0.38 },
    { x: 0.52, y: 0.62 }
  ]);
});

test("ROI second pass replaces only the selected region evidence and records Foundation provenance", async () => {
  const runtime = globalThis as typeof globalThis & { LuckyBeanRecognitionCore?: unknown };
  const previous = runtime.LuckyBeanRecognitionCore;
  runtime.LuckyBeanRecognitionCore = {
    async preparePackageImage(blob: Blob) { return { blob }; },
    async recognizeCoffeeBag() { return { blocks: [], fullText: "" }; },
    getRecognitionCapabilities() { return { webPaddleRegion: true }; },
    async recognizeImageRegion(_image: unknown, region: unknown) {
      return {
        regionProtocol: ROI_RECOGNITION_PROTOCOL,
        region,
        engine: "fixture-roi-worker",
        outputWidth: 100,
        outputHeight: 50,
        sourceWidth: 1000,
        sourceHeight: 800,
        cropWidth: 400,
        cropHeight: 320,
        blocks: [
          { text: "Kenya", confidence: 0.95, polygon: [[10, 5], [90, 5], [90, 20], [10, 20]] },
          { text: "Washed", confidence: 0.93, polygon: [[10, 25], [80, 25], [80, 45], [10, 45]] }
        ]
      };
    },
    createRecognitionDocument(input: Record<string, unknown>) { return input; },
    analyzeRecognitionDocument(document: Record<string, unknown>) { return { document, fields: [], parsed: {} }; }
  };
  try {
    assert.equal(regionRecognitionAvailable(), true);
    const result = await refineSegmentationRegionEvidence({
      file: new File([new Uint8Array([1, 2, 3])], "menu.jpg", { type: "image/jpeg" }),
      model: fixtureModel(),
      regionIndex: 0
    });
    assert.equal(result.provenance.status, "success");
    assert.equal(result.provenance.protocol, ROI_RECOGNITION_PROTOCOL);
    assert.equal(result.provenance.engine, "fixture-roi-worker");
    assert.equal(result.model.regions[0].lineIds.length, 2);
    assert.equal(result.model.lines.some((line) => line.id === "old-1"), false);
    assert.equal(result.model.lines.some((line) => line.id === "other-1"), true);
    assert.deepEqual(result.model.lines.filter((line) => result.model.regions[0].lineIds.includes(line.id)).map((line) => line.text), ["Kenya", "Washed"]);

    const refinements = new Map([[result.model.regions[0].id, result.provenance]]);
    const attached = attachROIRefinementProvenance(fixturePage(), result.model, refinements);
    const recognition = attached.samples[0].metadata.recognition as Record<string, unknown>;
    assert.equal(recognition.schemaVersion, "aromasense-recognition/3.4");
    assert.equal((recognition.roiRefinement as Record<string, unknown>).status, "success");
  } finally {
    runtime.LuckyBeanRecognitionCore = previous;
  }
});
