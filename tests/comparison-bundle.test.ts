import assert from "node:assert/strict";
import test from "node:test";
import { comparisonFields, mapComparison, type ComparisonBundle } from "../app/core/comparison-bundle";
import type { CuppingRecordSnapshot } from "../app/core/session-record-service";

function snapshot(mode: "open" | "blind"): CuppingRecordSnapshot {
  return { version: "AromaSense-B0.2.a", exportedAt: "now", session: { sessionId: "local", metadata: { date: "2026-09-04", time: "20:00", organizer: "Lab", cuppingMode: mode }, status: "completed", taxonomyVersion: "sensory-flow/2.0", createdAt: "now", updatedAt: "now" },
    samples: [{ sampleId: "s1", sessionId: "local", displayNumber: 9, sortOrder: 9, label: "A", metadata: { eventSampleId: "es1", sampleCode: "C01" }, createdAt: "now", updatedAt: "now" }],
    observations: [{ observationId: "o1", sessionId: "local", sampleId: "s1", stageId: "flavor", fieldKey: "flavor_tags", value: ["jasmine", "lemon"], dictionaryVersion: "v", updatedAt: "now" }], stageStates: [] };
}

const peer: ComparisonBundle = { schemaVersion: "aromasense-comparison/1.0", comparisonSubjectId: "peer", eventId: "e", eventRevision: 1, mode: "open", samples: [
  { eventSampleId: "es1", sampleCode: "C01", sampleIndex: 0, canonicalMetadata: {}, observations: [{ flowStep: "flavor", fieldKey: "flavor_tags", value: ["jasmine", "peach"] }] }
] };

test("comparison identity ignores display order and presentation distinguishes overlap and peer-only tags", () => {
  const local = snapshot("open"); const mapping = mapComparison(local, peer);
  assert.equal(mapping.entries[0].matchedBy, "eventSampleId");
  assert.deepEqual(comparisonFields(local, peer, mapping, "s1")[0].overlappingTags, ["jasmine"]);
  assert.deepEqual(comparisonFields(local, peer, mapping, "s1")[0].peerOnlyTags, ["peach"]);
});

test("blind comparison never falls back to canonical metadata or displayOrder", () => {
  const local = snapshot("blind"); local.samples[0].metadata = { sampleIndex: 7 }; local.samples[0].displayNumber = 99;
  const mapped = mapComparison(local, { ...peer, mode: "blind", samples: [{ ...peer.samples[0], eventSampleId: "", sampleCode: "", sampleIndex: 7 }] });
  assert.equal(mapped.entries[0].matchedBy, "sampleIndex");
});

test("open comparison uses global sample identity only after event, code and canonical matching", () => {
  const local = snapshot("open");
  local.samples[0].metadata = { globalSampleId: "GLOBAL-42" };
  const mapped = mapComparison(local, {
    ...peer,
    samples: [{ ...peer.samples[0], eventSampleId: "", sampleCode: "", canonicalMetadata: { globalSampleId: "global-42" } }]
  });
  assert.equal(mapped.entries[0].matchedBy, "globalSampleId");
});
