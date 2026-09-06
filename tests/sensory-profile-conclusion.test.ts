import assert from "node:assert/strict";
import test from "node:test";
import type { SensoryObservation, StageId } from "../shared/protocol/aromasense-v1";
import { deriveSensoryProfileConclusion } from "../app/core/sensory-profile-conclusion";

function obs(stageId: StageId, fieldKey: string, value: unknown): SensoryObservation {
  return {
    observationId: `obs:${stageId}:${fieldKey}`,
    sessionId: "profile-session",
    sampleId: "profile-sample",
    stageId,
    fieldKey,
    value,
    dictionaryVersion: "sensory-dictionary/1.2",
    updatedAt: "2026-09-06T20:00:00+08:00"
  };
}

test("profile uses seven structural axes, excludes balance and keeps temperature flavor semantics", () => {
  const observations = [
    obs("aroma", "wet_aroma_intensity", 12),
    obs("high_temp", "acidity_intensity", 12), obs("high_temp", "sweetness_intensity", 6), obs("high_temp", "bitterness_intensity", 2), obs("high_temp", "mouthfeel_intensity", 7), obs("high_temp", "flavor_tags", ["jasmine"]),
    obs("mid_temp", "acidity_intensity", 9), obs("mid_temp", "sweetness_intensity", 9), obs("mid_temp", "bitterness_intensity", 2), obs("mid_temp", "mouthfeel_intensity", 8), obs("mid_temp", "finish_intensity", 9), obs("mid_temp", "flavor_tags", ["orange"]),
    obs("low_temp", "acidity_intensity", 6), obs("low_temp", "sweetness_intensity", 11), obs("low_temp", "bitterness_intensity", 2), obs("low_temp", "mouthfeel_intensity", 7), obs("low_temp", "finish_intensity", 9), obs("low_temp", "flavor_tags", ["black_tea"]),
    obs("overall", "quality_clean", 9)
  ];

  const profile = deriveSensoryProfileConclusion(observations);
  assert.deepEqual(profile.radar.map((item) => item.key), ["aroma", "acidity", "sweetness", "bitterness", "mouthfeel", "finish", "cleanliness"]);
  assert.equal(profile.radar.some((item) => item.key === "balance"), false);
  assert.equal(profile.radar.find((item) => item.key === "acidity")?.value, 9);
  assert.deepEqual(profile.temperature.map((item) => item.flavorFamily), ["white_floral", "citrus", "tea"]);
});
