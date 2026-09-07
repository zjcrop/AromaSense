import assert from "node:assert/strict";
import test from "node:test";
import { deriveStageStatus } from "../app/core/cupping-progress-policy";
import type { SensoryObservation, StageId } from "../shared/protocol/aromasense-v1";

function observations(stageId: StageId, values: Record<string, unknown>): SensoryObservation[] {
  return Object.entries(values).map(([fieldKey, value], index) => ({
    observationId: `${stageId}:${fieldKey}:${index}`,
    sessionId: "progress-session",
    sampleId: "progress-sample",
    stageId,
    fieldKey,
    value,
    dictionaryVersion: "test",
    updatedAt: "2026-09-07T06:40:00Z"
  }));
}

test("browsing an empty stage never changes it from not_started", () => {
  assert.equal(deriveStageStatus("aroma", []), "not_started");
  assert.equal(deriveStageStatus("high_temp", []), "not_started");
  assert.equal(deriveStageStatus("overall", []), "not_started");
  assert.equal(deriveStageStatus("scoring", []), "not_started");
});

test("first meaningful sensory write activates a stage and required fields complete it", () => {
  assert.equal(
    deriveStageStatus("aroma", observations("aroma", { wet_aroma_intensity: 7 })),
    "active"
  );
  assert.equal(
    deriveStageStatus("aroma", observations("aroma", { wet_aroma_intensity: 7, flavor_tags: ["jasmine"] })),
    "completed"
  );
});

test("legacy navigation control fields do not count as sensory progress", () => {
  assert.equal(
    deriveStageStatus("final", observations("final", { final_phase: "overall" })),
    "not_started"
  );
});

test("zero is meaningful sensory data rather than missing data", () => {
  assert.equal(
    deriveStageStatus("high_temp", observations("high_temp", {
      flavor_tags: ["clean"],
      acidity_intensity: 0,
      sweetness_intensity: 0,
      bitterness_intensity: 0,
      mouthfeel_intensity: 0
    })),
    "completed"
  );
});
