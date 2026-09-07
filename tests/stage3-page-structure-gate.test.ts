import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument, type OCRLineInput } from "../app/core/ocr-layout-model";
import { harvestRecognitionEvidence } from "../app/core/recognition-evidence-harvester";
import { SampleRecognitionService } from "../app/core/sample-recognition-service";
import { mapStructuredPageRecognition } from "../app/core/structured-page-recognition";
import type { PageStructureResult } from "../app/core/page-structure-contract";

function line(id: string, text: string, left: number, top: number, right: number, bottom: number): OCRLineInput {
  return {
    id,
    blockId: id,
    text,
    confidence: 0.98,
    polygon: [[left, top], [right, top], [right, bottom], [left, bottom]]
  };
}

const fixtureLines = [
  line("a-anchor", "A", 80, 40, 120, 65),
  line("a-origin", "Ethiopia Guji", 80, 80, 440, 110),
  line("a-variety", "Gesha", 80, 125, 260, 155),
  line("a-process", "Natural", 80, 170, 300, 200),
  line("a-flavor", "Jasmine", 80, 215, 300, 245),
  line("b-anchor", "B", 80, 420, 120, 445),
  line("b-origin", "Kenya Nyeri", 80, 460, 440, 490),
  line("b-variety", "SL28", 80, 505, 260, 535),
  line("b-process", "Washed", 80, 550, 300, 580),
  line("b-flavor", "Blackcurrant", 80, 595, 360, 625),
  line("audit-bank", "銀行帳號 12345678", 680, 700, 1100, 735)
];

function fixtureDocument() {
  return buildOCRLayoutDocument({
    imageId: "stage3-page-structure",
    sourceWidth: 1200,
    sourceHeight: 800,
    lines: fixtureLines
  });
}

function pageStructureResult(samples = 2): PageStructureResult {
  const all = [
    {
      sampleRef: "sample-a",
      confidence: 0.91,
      evidenceRefs: ["a-origin", "a-variety", "a-process", "a-flavor"],
      fields: [
        { field: "country" as const, value: "Ethiopia", confidence: 0.92, evidenceRefs: ["a-origin"] },
        { field: "variety" as const, value: "Gesha", confidence: 0.91, evidenceRefs: ["a-variety"] },
        { field: "process" as const, value: "Natural", confidence: 0.93, evidenceRefs: ["a-process"] }
      ]
    },
    {
      sampleRef: "sample-b",
      confidence: 0.9,
      evidenceRefs: ["b-origin", "b-variety", "b-process", "b-flavor"],
      fields: [
        { field: "country" as const, value: "Kenya", confidence: 0.91, evidenceRefs: ["b-origin"] },
        { field: "variety" as const, value: "SL28", confidence: 0.9, evidenceRefs: ["b-variety"] },
        { field: "process" as const, value: "Washed", confidence: 0.92, evidenceRefs: ["b-process"] }
      ]
    }
  ];
  return {
    schemaVersion: "ai-page-structure-result/1.0",
    task: "structure-page",
    engine: "fixture-ai",
    model: "fixture-model",
    createdAt: "2026-09-07T00:00:00.000Z",
    inputFingerprint: "fixture-fingerprint",
    samples: all.slice(0, samples),
    unassignedEvidence: ["unassigned-heading"],
    policy: { authority: "advisory", mayInventFact: false, mayOverwriteFact: false }
  };
}

function recognitionMetadata(sample: { metadata: Record<string, unknown> }): Record<string, unknown> {
  return sample.metadata.recognition as Record<string, unknown>;
}

function pageStructureMetadata(sample: { metadata: Record<string, unknown> }): Record<string, unknown> {
  return recognitionMetadata(sample).pageStructure as Record<string, unknown>;
}

function installMockRecognitionCore() {
  const coreDescriptor = Object.getOwnPropertyDescriptor(globalThis, "LuckyBeanRecognitionCore");
  const bookDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__AROMASENSE_RECOGNITION_BOOK__");
  const blocks = fixtureLines.map((item) => ({
    id: item.id,
    blockId: item.blockId,
    text: item.text,
    confidence: item.confidence,
    polygon: item.polygon
  }));
  const fullText = fixtureLines.map((item) => item.text).join("\n");
  const core = {
    RECOGNITION_PIPELINE_VERSION: "stage3-fixture-core",
    async preparePackageImage(blob: Blob) {
      return { blob, width: 1200, height: 800, processedWidth: 1200, processedHeight: 800, score: 0.98, status: "ok", warnings: [] };
    },
    async recognizeCoffeeBag() {
      return { engine: "fixture-ocr", blocks, fullText };
    },
    createRecognitionDocument(input: Record<string, unknown>) {
      return { ...input, schemaVersion: "recognition-document/1.0", parserVersion: "stage3-fixture", relations: [] };
    },
    analyzeRecognitionDocument(document: Record<string, unknown>) {
      return { pipelineVersion: "stage3-fixture-core", document, semanticText: document.fullText, fields: [], resolvedCount: 0, reviewCount: 0 };
    }
  };
  Object.defineProperty(globalThis, "LuckyBeanRecognitionCore", { configurable: true, writable: true, value: core });
  Object.defineProperty(globalThis, "__AROMASENSE_RECOGNITION_BOOK__", {
    configurable: true,
    writable: true,
    value: { countries: ["x"], regions: ["x"], entities: ["x"], varieties: ["x"], processes: ["x"], flavors: ["x"] }
  });
  return () => {
    if (coreDescriptor) Object.defineProperty(globalThis, "LuckyBeanRecognitionCore", coreDescriptor);
    else Reflect.deleteProperty(globalThis, "LuckyBeanRecognitionCore");
    if (bookDescriptor) Object.defineProperty(globalThis, "__AROMASENSE_RECOGNITION_BOOK__", bookDescriptor);
    else Reflect.deleteProperty(globalThis, "__AROMASENSE_RECOGNITION_BOOK__");
  };
}

function foundation(structurePage: () => Promise<{ ok: boolean; result?: PageStructureResult; reason?: string }>) {
  return {
    resolve(field: string, value: string) {
      return { field, rawValue: value, normalizedValue: value, status: "confirmed" as const, reason: "fixture", selected: null };
    },
    structurePage
  };
}

test("Stage 3 gate: evidence harvester excludes irrelevant account text but keeps it auditable", () => {
  const harvest = harvestRecognitionEvidence(fixtureDocument());
  assert.equal(harvest.shouldUseStructureAi, true);
  assert.equal(harvest.metrics.sourceBlocks, 11);
  assert.equal(harvest.metrics.retainedBlocks, 10);
  assert.equal(harvest.metrics.ignoredBlocks, 1);
  assert.deepEqual(harvest.auditOnly.map((item) => item.id), ["audit-bank"]);
  assert.equal(harvest.blocks.some((item) => item.id === "audit-bank"), false);
  assert.deepEqual(harvest.layoutHints.anchorRefs, ["a-anchor", "b-anchor"]);
});

test("Stage 3 gate: mapped AI grouping preserves assigned, unassigned and ignored evidence audit", () => {
  const mapped = mapStructuredPageRecognition({
    result: pageStructureResult(2),
    document: fixtureDocument(),
    fileName: "fixture.jpg",
    mimeType: "image/jpeg",
    engine: "fixture-ocr",
    pageLayout: "vertical-block-list",
    layoutConfidence: 0.82,
    multiRecordProbability: 0.9,
    ignoredEvidenceRefs: ["audit-bank"]
  });
  assert.equal(mapped.length, 2);
  assert.match(mapped[0]?.rawText ?? "", /Ethiopia Guji/u);
  assert.doesNotMatch(mapped[0]?.rawText ?? "", /Kenya Nyeri|銀行帳號/u);
  assert.match(mapped[1]?.rawText ?? "", /Kenya Nyeri/u);
  const pageStructure = pageStructureMetadata(mapped[0]!);
  assert.deepEqual(pageStructure.sampleEvidenceRefs, ["a-origin", "a-variety", "a-process", "a-flavor"]);
  assert.deepEqual(pageStructure.unassignedEvidenceRefs, ["unassigned-heading"]);
  assert.deepEqual(pageStructure.ignoredEvidenceRefs, ["audit-bank"]);
  assert.deepEqual(pageStructure.policy, { authority: "advisory", mayInventFact: false, mayOverwriteFact: false });
});

test("Stage 3 gate: structure AI unavailable falls back to deterministic layout with an explicit reason", async () => {
  const restore = installMockRecognitionCore();
  try {
    let calls = 0;
    const service = new SampleRecognitionService(foundation(async () => {
      calls += 1;
      return { ok: false, reason: "fixture-ai-unavailable" };
    }));
    const page = await service.recognizePage(new File(["fixture"], "fixture.jpg", { type: "image/jpeg" }));
    assert.equal(calls, 1);
    assert.ok(page.samples.length >= 1);
    for (const sample of page.samples) {
      const structure = pageStructureMetadata(sample);
      assert.equal(structure.strategy, "layout-fallback-after-ai");
      assert.equal(structure.aiAttempted, true);
      assert.equal(structure.fallbackReason, "fixture-ai-unavailable");
      assert.deepEqual(structure.ignoredEvidenceRefs, ["audit-bank"]);
    }
  } finally {
    restore();
  }
});

test("Stage 3 gate: a single-record AI response cannot replace deterministic multi-record fallback", async () => {
  const restore = installMockRecognitionCore();
  try {
    let calls = 0;
    const service = new SampleRecognitionService(foundation(async () => {
      calls += 1;
      return { ok: true, result: pageStructureResult(1) };
    }));
    const page = await service.recognizePage(new File(["fixture"], "fixture.jpg", { type: "image/jpeg" }));
    assert.equal(calls, 1);
    assert.ok(page.samples.length >= 2);
    for (const sample of page.samples) {
      const structure = pageStructureMetadata(sample);
      assert.equal(structure.strategy, "layout-fallback-after-ai");
      assert.equal(structure.fallbackReason, "structure-ai-returned-single-record");
    }
  } finally {
    restore();
  }
});
