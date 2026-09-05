import assert from "node:assert/strict";
import test from "node:test";
import { buildSubmissionBundle, completeCsv } from "../app/core/submission-bundle";
import { comparisonBundleFromSubmission } from "../app/core/comparison-bundle";
import { normalizeImportBundle } from "../app/core/import-bundle";
import type { CuppingRecordSnapshot } from "../app/core/session-record-service";

const snapshot: CuppingRecordSnapshot = {
  version: "AromaSense-B0.2.a", exportedAt: "2026-09-04T12:00:00Z",
  session: { sessionId: "session-1", title: "公开杯测", metadata: { date: "2026-09-04", time: "20:00", organizer: "Lab", eventId: "event-1", eventRevision: 3, lowPrecisionLocation: { latitude: 31.2, longitude: 121.5, accuracyKm: 5 } }, status: "completed", taxonomyVersion: "sensory-flow/2.0", createdAt: "2026-09-04T11:00:00Z", updatedAt: "2026-09-04T12:00:00Z", completedAt: "2026-09-04T12:00:00Z" },
  samples: [{ sampleId: "sample-1", sessionId: "session-1", displayNumber: 2, sortOrder: 1, label: "Gesha", metadata: { eventSampleId: "es-1", sampleCode: "A01", globalSampleId: "global-42", canonical: { country: "ET" } }, createdAt: "2026-09-04T11:00:00Z", updatedAt: "2026-09-04T12:00:00Z" }],
  observations: [{ observationId: "o1", sessionId: "session-1", sampleId: "sample-1", stageId: "aroma", fieldKey: "notes", value: "jasmine, citrus", dictionaryVersion: "v1", updatedAt: "2026-09-04T11:30:00Z" }],
  stageStates: [{ sessionId: "session-1", sampleId: "sample-1", stageId: "aroma", status: "completed", startedAt: "2026-09-04T11:20:00Z", completedAt: "2026-09-04T11:30:00Z", updatedAt: "2026-09-04T11:30:00Z" }]
};

test("submission bundle carries immutable matching interfaces and stable content hash", async () => {
  const first = await buildSubmissionBundle(snapshot, 2);
  const second = await buildSubmissionBundle({ ...snapshot, exportedAt: "2026-09-04T13:00:00Z" });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.revision, 2);
  assert.equal(first.eventManifest.eventRevision, 3);
  assert.equal(first.eventBindings[0].eventSampleId, "es-1");
  assert.equal(first.eventBindings[0].sampleIndex, undefined);
  assert.match(first.eventManifest.interfaces.deepLink, /^https:/);
  assert.match(completeCsv(snapshot, first), /"jasmine, citrus"/);
  const imported = normalizeImportBundle(first, { kind: "json" });
  assert.equal(imported?.sessions[0].metadata.eventId, "event-1");
  assert.equal(imported?.sessions[0].metadata.eventRevision, 3);
  assert.equal(imported?.sessions[0].metadata.lowPrecisionLocation?.accuracyKm, 5);
  assert.equal(imported?.sessions[0].samples[0].metadata.eventSampleId, "es-1");
  assert.equal(imported?.sessions[0].samples[0].metadata.sampleCode, "A01");
  assert.equal(comparisonBundleFromSubmission(first, "peer").samples[0].canonicalMetadata.globalSampleId, "global-42");
});

test("event bindings never change identity when sample display order changes", async () => {
  const a = { ...snapshot.samples[0], metadata: { sampleIndex: 4 } };
  const b = { ...a, sampleId: "sample-2", metadata: { sampleIndex: 8 } };
  const first = await buildSubmissionBundle({ ...snapshot, samples: [a, b] });
  const reordered = await buildSubmissionBundle({ ...snapshot, samples: [{ ...b, displayNumber: 99, sortOrder: 1 }, { ...a, displayNumber: 42, sortOrder: 2 }] });
  for (const binding of first.eventBindings) assert.deepEqual(reordered.eventBindings.find((item) => item.localSampleId === binding.localSampleId), binding);
  const legacy = { ...a, metadata: {} };
  const original = await buildSubmissionBundle({ ...snapshot, samples: [legacy] });
  const moved = await buildSubmissionBundle({ ...snapshot, samples: [b, { ...legacy, displayNumber: 77 }] });
  assert.deepEqual(moved.eventBindings.find((item) => item.localSampleId === legacy.sampleId), original.eventBindings[0]);
  assert.equal(original.eventBindings[0].sampleIndex, undefined);
});
