import assert from "node:assert/strict";
import test from "node:test";
import { buildSampleBatch, moveSample, reorderSamples } from "../app/core/sample-batch-service";

const NOW = "2026-09-07T06:50:00Z";
const LATER = "2026-09-07T06:55:00Z";

function samples() {
  return buildSampleBatch(
    "session-identity",
    [
      { label: "A", metadata: { origin: "Ethiopia", sampleIndex: 0 } },
      { label: "B", metadata: { origin: "Kenya", sampleIndex: 1 } },
      { label: "C", metadata: { origin: "Colombia", sampleIndex: 2 } }
    ],
    NOW,
    (index) => `sample-${index + 1}`
  );
}

test("reordering changes sort order without rewriting stable sample identity", () => {
  const original = samples();
  const moved = moveSample(original, "sample-3", 0, LATER);

  assert.deepEqual(moved.map((sample) => sample.sampleId), ["sample-3", "sample-1", "sample-2"]);
  assert.deepEqual(moved.map((sample) => sample.sortOrder), [1, 2, 3]);

  const byId = new Map(moved.map((sample) => [sample.sampleId, sample] as const));
  assert.equal(byId.get("sample-1")?.metadata.origin, "Ethiopia");
  assert.equal(byId.get("sample-2")?.metadata.origin, "Kenya");
  assert.equal(byId.get("sample-3")?.metadata.origin, "Colombia");
  assert.equal(byId.get("sample-1")?.metadata.sampleIndex, 0);
  assert.equal(byId.get("sample-2")?.metadata.sampleIndex, 1);
  assert.equal(byId.get("sample-3")?.metadata.sampleIndex, 2);
});

test("display numbers and array positions are never accepted as identity substitutes", () => {
  const original = samples();
  const reordered = reorderSamples(original, ["sample-2", "sample-3", "sample-1"], LATER);

  assert.equal(reordered[0]?.sampleId, "sample-2");
  assert.equal(reordered[0]?.displayNumber, 2);
  assert.equal(reordered[0]?.metadata.sampleIndex, 1);
  assert.equal(reordered[2]?.sampleId, "sample-1");
  assert.equal(reordered[2]?.displayNumber, 1);
  assert.equal(reordered[2]?.metadata.sampleIndex, 0);
});
