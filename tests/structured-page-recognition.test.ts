import assert from "node:assert/strict";
import test from "node:test";
import { buildOCRLayoutDocument } from "../app/core/ocr-layout-model";
import { AI_PAGE_STRUCTURE_SCHEMA, type PageStructureResult } from "../app/core/page-structure-contract";
import { mapStructuredPageRecognition } from "../app/core/structured-page-recognition";

function document() {
  return buildOCRLayoutDocument({
    imageId: "page-1",
    sourceWidth: 1000,
    sourceHeight: 1000,
    lines: [
      { id: "e1", text: "Ethiopia", confidence: 0.96, box: { x: 40, y: 80, width: 260, height: 40 } },
      { id: "e2", text: "Washed", confidence: 0.95, box: { x: 40, y: 130, width: 260, height: 40 } },
      { id: "e3", text: "Kenya", confidence: 0.97, box: { x: 560, y: 80, width: 260, height: 40 } },
      { id: "e4", text: "SL28", confidence: 0.94, box: { x: 560, y: 130, width: 260, height: 40 } },
      { id: "e5", text: "Lot note awaiting assignment", confidence: 0.9, box: { x: 300, y: 260, width: 360, height: 40 } }
    ]
  });
}

function result(unassignedEvidence: readonly string[]): PageStructureResult {
  return {
    schemaVersion: AI_PAGE_STRUCTURE_SCHEMA,
    task: "structure-page",
    engine: "fixture-ai",
    model: "fixture",
    createdAt: "2026-09-07T06:58:00Z",
    inputFingerprint: "fixture-fingerprint",
    samples: [
      {
        sampleRef: "sample-a",
        confidence: 0.95,
        evidenceRefs: ["e1", "e2"],
        fields: [
          { field: "label", value: "Ethiopia Washed", confidence: 0.96, evidenceRefs: ["e1", "e2"] },
          { field: "country", value: "Ethiopia", confidence: 0.96, evidenceRefs: ["e1"] },
          { field: "process", value: "Washed", confidence: 0.95, evidenceRefs: ["e2"] }
        ]
      },
      {
        sampleRef: "sample-b",
        confidence: 0.95,
        evidenceRefs: ["e3", "e4"],
        fields: [
          { field: "label", value: "Kenya SL28", confidence: 0.96, evidenceRefs: ["e3", "e4"] },
          { field: "country", value: "Kenya", confidence: 0.97, evidenceRefs: ["e3"] },
          { field: "variety", value: "SL28", confidence: 0.94, evidenceRefs: ["e4"] }
        ]
      }
    ],
    unassignedEvidence,
    policy: { authority: "advisory", mayInventFact: false, mayOverwriteFact: false }
  };
}

function mapped(unassignedEvidence: readonly string[]) {
  return mapStructuredPageRecognition({
    result: result(unassignedEvidence),
    document: document(),
    fileName: "fixture.jpg",
    mimeType: "image/jpeg",
    engine: "fixture-ocr",
    pageLayout: "two-column",
    layoutConfidence: 0.95,
    multiRecordProbability: 0.95,
    ignoredEvidenceRefs: []
  });
}

test("high-confidence structured samples can remain review-free when all retained evidence is assigned", () => {
  const samples = mapped([]);
  assert.equal(samples.length, 2);
  assert.equal(samples.every((sample) => sample.requiresReview === false), true);
});

test("any retained unassigned OCR evidence forces structured samples into Review", () => {
  const samples = mapped(["e5"]);
  assert.equal(samples.length, 2);
  assert.equal(samples.every((sample) => sample.requiresReview === true), true);
  const recognition = samples[0]?.metadata.recognition as { pageStructure?: { unassignedEvidenceRefs?: readonly string[] } };
  assert.deepEqual(recognition.pageStructure?.unassignedEvidenceRefs, ["e5"]);
});
