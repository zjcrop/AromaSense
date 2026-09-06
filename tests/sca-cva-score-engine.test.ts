import assert from "node:assert/strict";
import test from "node:test";
import type { SensoryObservation } from "../shared/protocol/aromasense-v1";
import {
  calculateSCACVAScore,
  SCA_CVA_AFFECTIVE_FIELDS,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_NON_UNIFORM_CUPS_FIELD
} from "../app/core/sca-cva-score-engine";

function obs(fieldKey: string, value: unknown): SensoryObservation {
  return {
    observationId: `obs:${fieldKey}`,
    sessionId: "sca-session",
    sampleId: "sca-sample",
    stageId: "overall",
    fieldKey,
    value,
    dictionaryVersion: "sensory-flow/2.0",
    updatedAt: "2026-09-06T20:00:00+08:00"
  };
}

function complete(score: number, nonUniform = 0, defective = 0): SensoryObservation[] {
  return [
    ...SCA_CVA_AFFECTIVE_FIELDS.map((field) => obs(field.key, score)),
    obs(SCA_NON_UNIFORM_CUPS_FIELD, nonUniform),
    obs(SCA_DEFECTIVE_CUPS_FIELD, defective)
  ];
}

test("SCA-104 endpoints and cup penalties stay deterministic", () => {
  assert.equal(calculateSCACVAScore(complete(1)).score, 58);
  assert.equal(calculateSCACVAScore(complete(9)).score, 100);
  assert.equal(calculateSCACVAScore(complete(8)).score, 94.75);
  assert.equal(calculateSCACVAScore(complete(8, 2, 1)).score, 86.75);
});

test("missing fields never become zero and AromaSense descriptors cannot alter SCA", () => {
  const incomplete = calculateSCACVAScore(complete(8).slice(1));
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.score, undefined);

  const base = complete(8);
  const withProfile = [
    ...base,
    obs("quality_clean", 1),
    obs("acidity_intensity", 15),
    obs("flavor_tags", ["jasmine"])
  ];
  assert.equal(calculateSCACVAScore(withProfile).score, calculateSCACVAScore(base).score);
});
