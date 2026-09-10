import assert from "node:assert/strict";
import test from "node:test";
import type { SensoryObservation, StageId } from "../shared/protocol/aromasense-v1";
import {
  AROMA_SCA_SCORE_FIELDS,
  aggregateScoringStatus,
  calculateAggregateSCAScore,
  latestObservationValue,
  overallEntryStatus,
  stableFlavorUnion
} from "../app/ui/dom/cupping-final-ux-20260910";
import { SCA_DEFECTIVE_CUPS_FIELD, SCA_NON_UNIFORM_CUPS_FIELD } from "../app/core/sca-cva-score-engine";

function observation(stageId: StageId, fieldKey: string, value: unknown, updatedAt = "2026-09-10T10:00:00.000Z"): SensoryObservation {
  return {
    observationId: `${stageId}:${fieldKey}:${updatedAt}`,
    sessionId: "session-final-ux",
    sampleId: "sample-final-ux",
    stageId,
    fieldKey,
    value,
    dictionaryVersion: "test",
    updatedAt
  };
}

const overallSix = [
  observation("overall", "final_sca_affective_flavor", 7),
  observation("overall", "final_sca_affective_aftertaste", 7),
  observation("overall", "final_sca_affective_acidity", 7),
  observation("overall", "final_sca_affective_sweetness", 7),
  observation("overall", "final_sca_affective_mouthfeel", 7),
  observation("overall", "final_sca_affective_overall", 7),
  observation("overall", SCA_NON_UNIFORM_CUPS_FIELD, 0),
  observation("overall", SCA_DEFECTIVE_CUPS_FIELD, 0),
  observation("overall", "quality_clean", 8)
] as const;

test("overall completes with the six overall affective fields and does not duplicate aroma scores", () => {
  assert.equal(overallEntryStatus(overallSix), "completed");
  assert.equal(overallSix.some((item) => AROMA_SCA_SCORE_FIELDS.includes(item.fieldKey as typeof AROMA_SCA_SCORE_FIELDS[number])), false);
});

test("aggregate SCA scoring reads fragrance and aroma values from the aroma node", () => {
  const observations = [
    observation("aroma", AROMA_SCA_SCORE_FIELDS[0], 8, "2026-09-10T10:01:00.000Z"),
    observation("aroma", AROMA_SCA_SCORE_FIELDS[1], 7, "2026-09-10T10:02:00.000Z"),
    ...overallSix
  ];
  const score = calculateAggregateSCAScore(observations);
  assert.equal(score.complete, true);
  assert.equal(aggregateScoringStatus(observations), "completed");
  assert.equal(latestObservationValue(observations, AROMA_SCA_SCORE_FIELDS[0]), 8);
});

test("newer aroma score wins over a historical duplicate stored in overall", () => {
  const observations = [
    observation("overall", AROMA_SCA_SCORE_FIELDS[0], 4, "2026-09-09T10:00:00.000Z"),
    observation("aroma", AROMA_SCA_SCORE_FIELDS[0], 9, "2026-09-10T10:00:00.000Z")
  ];
  assert.equal(latestObservationValue(observations, AROMA_SCA_SCORE_FIELDS[0]), 9);
});

test("all-load flavor merge preserves high-mid-low order and de-duplicates tags", () => {
  assert.deepEqual(
    stableFlavorUnion(["jasmine", "peach"], ["peach", "bergamot"], ["bergamot", "black_tea"]),
    ["jasmine", "peach", "bergamot", "black_tea"]
  );
});