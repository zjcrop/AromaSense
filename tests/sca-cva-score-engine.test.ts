import assert from "node:assert/strict";
import test from "node:test";
import type { SensoryObservation } from "../shared/protocol/aromasense-v1";
import {
  calculateSCACVAScore,
  SCA_CUP_CAPACITY_FIELD,
  SCA_CVA_AFFECTIVE_FIELDS,
  SCA_DEFECTIVE_CUPS_FIELD,
  SCA_DEFECT_TYPES_VALIDATION_KEY,
  SCA_DEFECT_UNIFORMITY_VALIDATION_KEY,
  SCA_NON_UNIFORM_CUPS_FIELD
} from "../app/core/sca-cva-score-engine";
import { DEFECT_ITEMS, defectPenalty } from "../app/core/defect-dictionary";

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

function complete(score: number, nonUniform = 0, defective = 0, defectIds?: string[]): SensoryObservation[] {
  return [
    ...SCA_CVA_AFFECTIVE_FIELDS.map((field) => obs(field.key, score)),
    obs(SCA_NON_UNIFORM_CUPS_FIELD, nonUniform),
    obs(SCA_DEFECTIVE_CUPS_FIELD, defective),
    ...(defective > 0 ? [obs("defect_ids", defectIds ?? ["defect-mold"])] : [])
  ];
}

test("SCA-104 endpoints and cup penalties stay deterministic", () => {
  assert.equal(calculateSCACVAScore(complete(1)).score, 58);
  assert.equal(calculateSCACVAScore(complete(9)).score, 100);
  assert.equal(calculateSCACVAScore(complete(8)).score, 94.75);
  assert.equal(calculateSCACVAScore(complete(8, 2, 1)).score, 86.75);
});

test("missing affective fields never become zero and AromaSense descriptors cannot alter SCA", () => {
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

test("cup penalty fields are optional and an untouched selector means zero", () => {
  const withoutCupFields = SCA_CVA_AFFECTIVE_FIELDS.map((field) => obs(field.key, 8));
  const result = calculateSCACVAScore(withoutCupFields);
  assert.equal(result.complete, true);
  assert.equal(result.nonUniformCups, 0);
  assert.equal(result.defectiveCups, 0);
  assert.equal(result.score, 94.75);
});

test("defective cups require an SCA-104 defect type rather than an arbitrary AromaSense defect tag", () => {
  const noType = calculateSCACVAScore(complete(8, 1, 1, []));
  assert.equal(noType.complete, false);
  assert.ok(noType.invalid.includes(SCA_DEFECT_TYPES_VALIDATION_KEY));

  const customOnly = calculateSCACVAScore(complete(8, 1, 1, ["defect-earthy"]));
  assert.equal(customOnly.complete, false);
  assert.ok(customOnly.invalid.includes(SCA_DEFECT_TYPES_VALIDATION_KEY));

  const potato = calculateSCACVAScore(complete(8, 1, 1, ["defect-potato"]));
  assert.equal(potato.complete, true);
  assert.deepEqual(potato.defectTypes, ["defect-potato"]);
});

test("defective cups must also be non-uniform unless every configured cup shares the defect", () => {
  const inconsistent = calculateSCACVAScore(complete(8, 1, 2, ["defect-phenolic"]));
  assert.equal(inconsistent.complete, false);
  assert.ok(inconsistent.invalid.includes(SCA_DEFECT_UNIFORMITY_VALIDATION_KEY));

  const allFive = calculateSCACVAScore(complete(8, 0, 5, ["defect-mold"]));
  assert.equal(allFive.complete, true, "SCA-104 permits the evenly defective five-cup exception");

  const extended = [
    ...complete(8, 0, 6, ["defect-mold"]),
    obs(SCA_CUP_CAPACITY_FIELD, 6)
  ];
  assert.equal(calculateSCACVAScore(extended).complete, true, "expanded cup capacity keeps the all-cups exception coherent");
});

test("P1 adds Potato to the scoring form without mutating the legacy AromaSense penalty model", () => {
  assert.equal(DEFECT_ITEMS.some((item) => item.id === "defect-potato"), true);
  assert.equal(defectPenalty(["defect-potato"]), 0);
});
