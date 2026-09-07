import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PAGE_STRUCTURE_SCHEMA,
  validatePageStructureEvidence,
  type PageStructureResult
} from "../app/core/page-structure-contract";

function validResult(): PageStructureResult {
  return {
    schemaVersion: AI_PAGE_STRUCTURE_SCHEMA,
    task: "structure-page",
    engine: "test-ai",
    model: "fixture",
    createdAt: "2026-09-07T06:30:00Z",
    inputFingerprint: "fixture-page-sha256",
    samples: [
      {
        sampleRef: "sample-a",
        confidence: 0.92,
        evidenceRefs: ["e1", "e2"],
        fields: [
          { field: "country", value: "Ethiopia", confidence: 0.97, evidenceRefs: ["e1"] },
          { field: "process", value: "Washed", confidence: 0.93, evidenceRefs: ["e2"] }
        ]
      },
      {
        sampleRef: "sample-b",
        confidence: 0.9,
        evidenceRefs: ["e3", "e4"],
        fields: [
          { field: "country", value: "Kenya", confidence: 0.96, evidenceRefs: ["e3"] },
          { field: "variety", value: "SL28", confidence: 0.91, evidenceRefs: ["e4"] }
        ]
      }
    ],
    unassignedEvidence: ["e5"],
    policy: { authority: "advisory", mayInventFact: false, mayOverwriteFact: false }
  };
}

test("whole-page AI structure accepts only evidence-bound sample facts", () => {
  const validation = validatePageStructureEvidence(validResult(), ["e1", "e2", "e3", "e4", "e5"]);
  assert.deepEqual(validation, { ok: true });
});

test("whole-page AI structure rejects evidence invented outside the OCR page", () => {
  const result = validResult();
  const invalid: PageStructureResult = {
    ...result,
    samples: [
      ...result.samples.slice(0, 1),
      {
        ...result.samples[1]!,
        fields: [
          { field: "variety", value: "Gesha", confidence: 0.99, evidenceRefs: ["hallucinated-evidence"] }
        ]
      }
    ]
  };
  const validation = validatePageStructureEvidence(invalid, ["e1", "e2", "e3", "e4", "e5"]);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.match(validation.reason, /^unknown-field-evidence:/u);
});

test("one OCR evidence block cannot silently belong to two coffee records", () => {
  const result = validResult();
  const invalid: PageStructureResult = {
    ...result,
    samples: [
      result.samples[0]!,
      {
        ...result.samples[1]!,
        evidenceRefs: ["e2", "e4"],
        fields: [{ field: "variety", value: "SL28", confidence: 0.91, evidenceRefs: ["e4"] }]
      }
    ]
  };
  const validation = validatePageStructureEvidence(invalid, ["e1", "e2", "e3", "e4", "e5"]);
  assert.deepEqual(validation, { ok: false, reason: "evidence-assigned-to-multiple-samples:e2" });
});

test("field evidence must remain inside the sample evidence boundary", () => {
  const result = validResult();
  const invalid: PageStructureResult = {
    ...result,
    samples: [
      {
        ...result.samples[0]!,
        fields: [{ field: "country", value: "Ethiopia", confidence: 0.97, evidenceRefs: ["e3"] }]
      },
      result.samples[1]!
    ]
  };
  const validation = validatePageStructureEvidence(invalid, ["e1", "e2", "e3", "e4", "e5"]);
  assert.deepEqual(validation, { ok: false, reason: "field-evidence-outside-sample:sample-a:country:e3" });
});
