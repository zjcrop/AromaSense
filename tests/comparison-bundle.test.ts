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

test("blind records without identity remain unmatched regardless of array or display order", () => {
  const local = snapshot("blind");
  for (const metadata of [{}, { sampleIndex: null }, { sampleIndex: "" }]) {
    local.samples[0].metadata = metadata;
    assert.deepEqual(mapComparison(local, { ...peer, mode: "blind" }).entries, []);
  }
});

test("comparison keeps repeated temperature fields separate and excludes workflow controls", () => {
  const local = snapshot("open");
  const base = local.observations[0];
  local.observations = [
    { ...base, stageId: "high_temp", fieldKey: "acidity_intensity", value: 8 },
    { ...base, stageId: "low_temp", fieldKey: "acidity_intensity", value: 4 },
    { ...base, stageId: "high_temp", fieldKey: "notes", value: "high own" },
    { ...base, stageId: "low_temp", fieldKey: "notes", value: "low own" },
    { ...base, stageId: "high_temp", fieldKey: "flavor_tags", value: ["jasmine"] },
    { ...base, stageId: "low_temp", fieldKey: "flavor_tags", value: ["lemon"] },
    { ...base, stageId: "scoring", fieldKey: "score_confirmed", value: true }
  ];
  const other: ComparisonBundle = { ...peer, samples: [{ ...peer.samples[0], observations: [
    { flowStep: "low_temp", fieldKey: "acidity_intensity", value: 3 },
    { flowStep: "high_temp", fieldKey: "acidity_intensity", value: 9 },
    { flowStep: "high_temp", fieldKey: "notes", value: "high peer" },
    { flowStep: "low_temp", fieldKey: "notes", value: "low peer" },
    { flowStep: "high_temp", fieldKey: "flavor_tags", value: ["jasmine", "peach"] },
    { flowStep: "low_temp", fieldKey: "flavor_tags", value: ["lemon", "cocoa"] },
    { flowStep: "final", fieldKey: "final_score_confirmed", value: false },
    { flowStep: "final", fieldKey: "final_phase", value: "score" },
    { flowStep: "low_temp", fieldKey: "stage_status", value: "completed" }
  ] }] };
  const before = structuredClone(local);
  const fields = comparisonFields(local, other, mapComparison(local, other), "s1");
  const field = (step: string, key: string) => fields.find((item) => item.flowStep === step && item.fieldKey === key);
  assert.equal(fields.length, 6);
  assert.equal(field("high_temp", "acidity_intensity")?.peer, 9);
  assert.equal(field("low_temp", "acidity_intensity")?.peer, 3);
  assert.equal(field("low_temp", "notes")?.peer, "low peer");
  assert.deepEqual(field("high_temp", "flavor_tags")?.overlappingTags, ["jasmine"]);
  assert.deepEqual(field("low_temp", "flavor_tags")?.peerOnlyTags, ["cocoa"]);
  assert.deepEqual(local, before);
});

test("identity priorities apply globally and ambiguous canonical matches stay unmatched", () => {
  const local = snapshot("open");
  const canonical = { decisions: [{ field: "country", selected: { canonicalId: "ET" } }] };
  local.samples = [
    { ...local.samples[0], sampleId: "ambiguous", metadata: { canonical } },
    { ...local.samples[0], sampleId: "exact", metadata: { eventSampleId: "es1", canonical } }
  ];
  const other = { ...peer, samples: [{ ...peer.samples[0], canonicalMetadata: canonical }] };
  assert.deepEqual(mapComparison(local, other).entries, [{ localSampleId: "exact", peerSampleIndex: 0, matchedBy: "eventSampleId" }]);
  local.samples = local.samples.map((item) => ({ ...item, metadata: { canonical } }));
  assert.deepEqual(mapComparison(local, other).entries, []);
});

test("legacy final observations compare against their corresponding new flow steps", () => {
  const local = snapshot("open");
  const other = { ...peer, samples: [{ ...peer.samples[0], observations: [{ flowStep: "final", fieldKey: "flavor_tags", value: ["jasmine"] }] }] };
  assert.deepEqual(comparisonFields(local, other, mapComparison(local, other), "s1")[0].overlappingTags, ["jasmine"]);
});
