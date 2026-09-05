import assert from "node:assert/strict";
import test from "node:test";
import { completionForStage } from "../app/core/completion-engine";
import type { SensoryObservation, StageId } from "../shared/protocol/aromasense-v1";

function observations(stageId: StageId, values: Record<string, unknown>): SensoryObservation[] {
  return Object.entries(values).map(([fieldKey, value]) => ({ observationId: fieldKey, sessionId: "s", sampleId: "x", stageId, fieldKey, value, dictionaryVersion: "test", updatedAt: "2026-09-04T00:00:00Z" }));
}

test("completion rules reject browsing-only and accept meaningful input", () => {
  assert.equal(completionForStage("aroma", []).complete, false);
  assert.equal(completionForStage("aroma", observations("aroma", { wet_aroma_intensity: 0 })).complete, false);
  assert.equal(completionForStage("aroma", observations("aroma", { wet_aroma_intensity: 0, flavor_tags: ["jasmine"] })).complete, true);
  assert.equal(completionForStage("high_temp", observations("high_temp", { acidity_intensity: 7, sweetness_intensity: 8 })).complete, false);
  assert.equal(completionForStage("high_temp", observations("high_temp", {
    flavor_tags: ["jasmine"], acidity_intensity: 7, sweetness_intensity: 8,
    bitterness_intensity: 2, mouthfeel_intensity: 7
  })).complete, true);
  assert.equal(completionForStage("scoring", observations("scoring", { score_confirmed: true })).complete, true);
});
